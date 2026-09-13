import { getCommitment } from '../db/repositories/commitments';
import { getGoal } from '../db/repositories/goals';
import { getMemoryById } from '../db/repositories/long-term-memory';
import { listMemorySources } from '../db/repositories/memory-sources';
import { getDocumentChunk, getDocumentIncludingDeleted } from '../rag/documents';
import type { ContextSourceDetailInfo } from '../shared/types';

const SOURCE_REF_PATTERN = /^(mem|goal|commitment):([A-Za-z0-9_-]{1,200})$|^doc:([A-Za-z0-9_-]{1,200})#chunk:(\d{1,6})$/;

function unavailable(sourceRef: string): ContextSourceDetailInfo {
  const type = sourceRef.startsWith('doc:') ? 'document'
    : sourceRef.startsWith('goal:') ? 'goal'
      : sourceRef.startsWith('commitment:') ? 'commitment' : 'memory';
  return {
    sourceType: type,
    sourceId: '',
    sourceRef,
    title: '来源当前不可用',
    content: null,
    meta: '来源可能已删除、替换或不再处于可用状态。',
    available: false,
  };
}

export function resolveContextSourceRef(sourceRef: string): ContextSourceDetailInfo {
  const ref = sourceRef.trim();
  const match = SOURCE_REF_PATTERN.exec(ref);
  if (!match) throw new Error('上下文来源引用格式无效');

  if (match[1] === 'mem') {
    const memory = getMemoryById(match[2]);
    if (!memory) return unavailable(ref);
    const sources = listMemorySources(memory.id);
    const latest = sources.at(-1);
    const sourceMeta = latest
      ? `来源：${latest.sourceType}${latest.sourceSessionId ? ` · 会话 ${latest.sourceSessionId}` : ''}`
      : '来源：历史记忆';
    return {
      sourceType: 'memory',
      sourceId: memory.id,
      sourceRef: ref,
      title: memory.memoryKey ?? '长期记忆',
      content: memory.sensitivity === 'private' ? '私密记忆内容已隐藏。' : memory.content,
      meta: `${sourceMeta} · 置信度 ${Math.round(memory.confidence * 100)}% · 更新于 ${new Date(memory.updatedAt).toLocaleString('zh-CN')}`,
      available: memory.status === 'active',
    };
  }

  if (match[1] === 'goal') {
    const goal = getGoal(match[2]);
    if (!goal) return unavailable(ref);
    return {
      sourceType: 'goal', sourceId: goal.id, sourceRef: ref, title: goal.title,
      content: goal.description, meta: `状态：${goal.status} · 优先级 ${goal.priority} · 更新于 ${new Date(goal.updatedAt).toLocaleString('zh-CN')}`,
      available: true,
    };
  }

  if (match[1] === 'commitment') {
    const commitment = getCommitment(match[2]);
    if (!commitment) return unavailable(ref);
    return {
      sourceType: 'commitment', sourceId: commitment.id, sourceRef: ref, title: commitment.title,
      content: commitment.promisedTo ? `承诺对象：${commitment.promisedTo}` : null,
      meta: `状态：${commitment.status} · 责任人：${commitment.owner === 'assistant' ? '助理' : '用户'}${commitment.dueAt ? ` · 截止 ${new Date(commitment.dueAt).toLocaleString('zh-CN')}` : ''}`,
      available: true,
    };
  }

  const documentId = match[3];
  const chunkIndex = Number(match[4]);
  // 历史 run 必须仍能回到已被新版本替代的旧文档；deleted 的 chunk 会被清理，因此仍自然不可用。
  const document = getDocumentIncludingDeleted(documentId);
  const chunk = getDocumentChunk(documentId, chunkIndex);
  if (!document || !chunk) return unavailable(ref);
  return {
    sourceType: 'document', sourceId: document.id, sourceRef: ref,
    title: `${document.filename} · 片段 ${chunkIndex + 1}`,
    content: chunk.content,
    meta: `文档 v${document.version} · ${document.freshnessStatus} · 最近检查 ${document.lastCheckedAt ? new Date(document.lastCheckedAt).toLocaleString('zh-CN') : '未检查'}`,
    available: true,
  };
}
