import { listMessages } from '../db/repositories/messages';
import { completeChat } from '../models/complete-chat';
import { getModelConfigSafe } from '../models/config';
import { getPerformanceSettings } from '../config/performance';
import { embedText } from './embedding';
import { getDocument, loadAllChunkEmbeddings } from './documents';
import { importTextAsKnowledge } from './text-import';
import type { DocumentInfo } from './documents';
import { cosineSimilarity } from './vector';

export type KnowledgeArchiveScope = 'session' | 'turn';

export interface KnowledgeArchiveIntent {
  triggered: boolean;
  scope: KnowledgeArchiveScope;
}

const ARCHIVE_VERB = /(?:计入|保存|写入|加入|归档|存到|存进|添加到)/;
const KNOWLEDGE_TARGET = /知识库/;
const QUESTION_HINT = /(?:什么是|是什么|怎么用|如何使用|如何|介绍|说明)/;

/** 检测用户是否明确要求将对话写入 RAG 知识库 */
export function parseKnowledgeArchiveIntent(message: string): KnowledgeArchiveIntent {
  const trimmed = message.trim();
  if (!trimmed || !KNOWLEDGE_TARGET.test(trimmed) || !ARCHIVE_VERB.test(trimmed)) {
    return { triggered: false, scope: 'session' };
  }

  if (QUESTION_HINT.test(trimmed) && !/(?:计入|保存|写入|加入|归档)/.test(trimmed)) {
    return { triggered: false, scope: 'session' };
  }

  const scope: KnowledgeArchiveScope = /(?:本轮|这一轮|刚才那轮|上一句|刚说的)/.test(trimmed)
    ? 'turn'
    : 'session';

  return { triggered: true, scope };
}

function formatDialogue(rows: Array<{ role: string; content: string }>): string {
  return rows
    .map((row) => `${row.role === 'user' ? '用户' : '助手'}：${row.content}`)
    .join('\n\n');
}

function getLatestCompletedTurn(
  rows: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  if (rows.length < 2) return [];

  const last = rows.at(-1)!;
  const secondLast = rows.at(-2)!;

  if (last.role === 'assistant' && secondLast.role === 'user') {
    return [secondLast, last];
  }

  return [];
}

/** 获取待归档的对话内容（不含触发归档指令本身） */
export function getDialogueForArchive(
  sessionId: string,
  scope: KnowledgeArchiveScope,
): Array<{ role: string; content: string }> {
  const all = listMessages(sessionId).filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );

  let rows = all;
  const last = all.at(-1);
  if (last?.role === 'user' && parseKnowledgeArchiveIntent(last.content).triggered) {
    rows = all.slice(0, -1);
  }

  if (scope === 'turn') {
    return getLatestCompletedTurn(rows);
  }

  return rows.map((m) => ({ role: m.role, content: m.content }));
}

function buildKnowledgeExtractionPrompt(): string {
  return `你是知识库整理助手。用户希望将一段对话提炼后写入 RAG 知识库，供日后检索引用。

【任务】
将对话中的有价值信息整理成一篇 Markdown 文档，要求：
1. 第一行必须是 # 标题（根据主题自拟，简洁准确）
2. 包含 ## 摘要（2-4 句话概括）
3. 包含 ## 要点（分条列出关键事实、规则、结论，保留具体数字、名称、日期）
4. 只保留对话中实际出现的信息，禁止编造
5. 若对话是纯闲聊、无实质可归档内容，仅输出一行：NO_CONTENT

【输出】
仅输出 Markdown 正文，不要用代码块包裹。`;
}

function sanitizeMarkdown(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'NO_CONTENT') return null;

  const unwrapped = trimmed
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!unwrapped || unwrapped === 'NO_CONTENT') return null;
  if (!unwrapped.startsWith('#')) {
    return `# 对话摘要\n\n${unwrapped}`;
  }
  return unwrapped;
}

function buildFilename(titleHint: string, sessionId: string): string {
  const slug = titleHint
    .replace(/^#+\s*/, '')
    .slice(0, 40)
    .replace(/[<>:"|?*\\/\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  const prefix = slug || 'chat';
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${date}-${sessionId.slice(0, 8)}.md`;
}

export interface ArchiveConversationResult {
  document: DocumentInfo;
  title: string;
  skippedDuplicate?: boolean;
}

async function findSemanticallySimilarDocument(
  summaryText: string,
  threshold: number,
  signal?: AbortSignal,
): Promise<DocumentInfo | null> {
  const stored = loadAllChunkEmbeddings();
  if (!stored.length) return null;

  const firstChunks = new Map<string, (typeof stored)[0]>();
  for (const chunk of stored) {
    if (!firstChunks.has(chunk.documentId) || chunk.chunkIndex === 0) {
      firstChunks.set(chunk.documentId, chunk);
    }
  }

  const queryVec = new Float32Array(await embedText(summaryText.slice(0, 500), signal));
  let bestDocId: string | null = null;
  let bestScore = 0;

  for (const chunk of firstChunks.values()) {
    const score = cosineSimilarity(queryVec, chunk.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestDocId = chunk.documentId;
    }
  }

  if (!bestDocId || bestScore < threshold) return null;
  return getDocument(bestDocId) ?? null;
}

/** 提炼对话并写入 RAG 知识库 */
export async function archiveConversationToKnowledge(
  sessionId: string,
  scope: KnowledgeArchiveScope = 'session',
  signal?: AbortSignal,
): Promise<ArchiveConversationResult> {
  const config = getModelConfigSafe();
  if (!config) {
    throw new Error('未配置 LLM API，无法提炼对话内容');
  }

  const dialogueRows = getDialogueForArchive(sessionId, scope);
  if (!dialogueRows.length) {
    throw new Error(
      scope === 'turn'
        ? '没有可归档的完整对话轮次。请先进行至少一轮问答，或使用「本次对话」归档整个会话。'
        : '当前会话没有可归档的对话内容。',
    );
  }

  const dialogue = formatDialogue(dialogueRows);

  const markdown = await completeChat(
    [
      { role: 'system', content: buildKnowledgeExtractionPrompt() },
      {
        role: 'user',
        content: `请将以下对话提炼为知识库文档：\n\n${dialogue}`,
      },
    ],
    config,
    { signal, sessionId },
  );
  if (signal?.aborted) throw new Error('已取消');

  const content = sanitizeMarkdown(markdown);
  if (!content) {
    throw new Error('对话中没有可归档的实质内容。');
  }

  const titleLine = content.split('\n').find((line) => line.startsWith('#')) ?? '# 对话摘要';
  const filename = buildFilename(titleLine, sessionId);

  const summarySection =
    content.match(/##\s*摘要\s*\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim() ??
    content.slice(0, 500);

  const threshold = getPerformanceSettings().ragArchiveDedupeThreshold;
  const similar = await findSemanticallySimilarDocument(summarySection, threshold, signal);
  if (similar) {
    return {
      document: similar,
      title: titleLine.replace(/^#+\s*/, '').trim(),
      skippedDuplicate: true,
    };
  }

  const document = await importTextAsKnowledge(content, filename, undefined, { signal });

  return {
    document,
    title: titleLine.replace(/^#+\s*/, '').trim(),
  };
}

export function buildArchiveConfirmation(result: ArchiveConversationResult): string {
  if (result.skippedDuplicate) {
    return `检测到与已有知识库文档「${result.document.filename}」内容高度相似，已跳过重复归档。

如需更新该文档，请在设置 → 泰提斯终端中重新导入或重建向量。`;
  }

  return `已将对话提炼并写入知识库。

**标题：** ${result.title}
**文档：** ${result.document.filename}
**分块数：** ${result.document.chunkCount}

之后你提问相关内容时，我会自动从知识库检索引用。`;
}
