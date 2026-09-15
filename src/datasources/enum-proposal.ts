/**
 * 字典自举（计划 §3.13.4）：对有取值表、还没登记枚举含义的列，让模型根据列名、注释、取值表**提议**含义；
 * 用户在设置页逐列确认后才写入人工层。这里只产出提议，不写库。
 */
import type { LlmMessage } from '../agent/types';
import { completeChat } from '../models/complete-chat';
import { createLinkedTimeoutSignal, awaitWithAbort } from '../agent/abort';
import type { DataDictionary } from './dictionary';

/** 取值超过这么多个就不当枚举提议（多半是名称 / 编号） */
export const ENUM_PROPOSAL_MAX_VALUES = 30;
export const ENUM_PROPOSAL_MAX_COLUMNS = 20;
export const ENUM_PROPOSAL_TIMEOUT_MS = 45_000;

export interface EnumProposalCandidate {
  column: string;
  type: string;
  comment?: string;
  businessName?: string;
  values: string[];
}

export interface EnumProposal {
  column: string;
  /** 取值 → 含义，只含取值表里真实存在的值 */
  values: Record<string, string>;
  note?: string;
}

export function collectEnumCandidates(dictionary: DataDictionary, tableName: string): EnumProposalCandidate[] {
  const table = dictionary.tables[tableName];
  if (!table) return [];
  const candidates: EnumProposalCandidate[] = [];
  for (const column of table.auto.columns) {
    const manual = table.columns[column.name];
    if (manual?.enumValues && Object.keys(manual.enumValues).length) continue;
    const values = manual?.knownValues ?? column.knownValues ?? [];
    if (values.length < 2 || values.length > ENUM_PROPOSAL_MAX_VALUES) continue;
    candidates.push({
      column: column.name,
      type: column.type,
      ...(column.comment ? { comment: column.comment } : {}),
      ...(manual?.businessName ? { businessName: manual.businessName } : {}),
      values,
    });
    if (candidates.length >= ENUM_PROPOSAL_MAX_COLUMNS) break;
  }
  return candidates;
}

const SYSTEM_PROMPT = `你在帮用户整理一个业务数据库的数据字典。下面给出一张表里若干"枚举型"列：列名、类型、注释、业务名（可能没有）以及数据库里实际出现的取值。
请推测每个取值的业务含义。规则：
- 只输出 JSON 数组，每项 {"column": 列名, "values": {取值: 含义}, "note": 一句话说明推测依据（可省略）}；不要输出别的文字。
- 含义用简短中文（2–6 字），如 "待付款"、"已发货"、"是"、"否"。
- 取值本身已经是可读中文或明显的名称时，含义照抄取值即可。
- 看不出含义的取值写 "?"，不要编造。列名与注释是最重要的线索。`;

export function buildEnumProposalMessages(tableName: string, tableBusinessName: string | undefined, candidates: EnumProposalCandidate[]): LlmMessage[] {
  const lines = candidates.map((candidate) => {
    const parts = [`列 ${candidate.column}（${candidate.type}）`];
    if (candidate.businessName) parts.push(`业务名：${candidate.businessName}`);
    if (candidate.comment) parts.push(`注释：${candidate.comment}`);
    parts.push(`取值：${candidate.values.map((value) => JSON.stringify(value)).join(', ')}`);
    return `- ${parts.join('；')}`;
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `表 ${tableName}${tableBusinessName ? `（${tableBusinessName}）` : ''}：\n${lines.join('\n')}`,
    },
  ];
}

function extractJsonArray(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 数组');
  return JSON.parse(stripped.slice(start, end + 1));
}

/** 宽容解析：忽略未知列、未知取值与非字符串含义；一列一条 */
export function parseEnumProposals(reply: string, candidates: EnumProposalCandidate[]): EnumProposal[] {
  const parsed = extractJsonArray(reply);
  if (!Array.isArray(parsed)) throw new Error('模型返回的不是数组');
  const byColumn = new Map(candidates.map((candidate) => [candidate.column, candidate]));
  const seen = new Set<string>();
  const proposals: EnumProposal[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const column = typeof record.column === 'string' ? record.column.trim() : '';
    const candidate = byColumn.get(column);
    if (!candidate || seen.has(column)) continue;
    const rawValues = record.values && typeof record.values === 'object' && !Array.isArray(record.values) ? (record.values as Record<string, unknown>) : {};
    const values: Record<string, string> = {};
    for (const value of candidate.values) {
      const meaning = rawValues[value];
      if (typeof meaning === 'string' && meaning.trim() && meaning.trim() !== '?') values[value] = meaning.trim().slice(0, 40);
    }
    if (!Object.keys(values).length) continue;
    seen.add(column);
    proposals.push({
      column,
      values,
      ...(typeof record.note === 'string' && record.note.trim() ? { note: record.note.trim().slice(0, 200) } : {}),
    });
  }
  return proposals;
}

export interface EnumProposalDeps {
  complete: (messages: LlmMessage[], signal: AbortSignal) => Promise<string>;
}

const defaultDeps: EnumProposalDeps = {
  complete: (messages, signal) => completeChat(messages, undefined, { signal }),
};

export async function proposeEnumMeanings(
  dictionary: DataDictionary,
  tableName: string,
  options: { signal?: AbortSignal } = {},
  deps: EnumProposalDeps = defaultDeps,
): Promise<{ proposals: EnumProposal[]; candidates: EnumProposalCandidate[] }> {
  const candidates = collectEnumCandidates(dictionary, tableName);
  if (!candidates.length) return { proposals: [], candidates };
  const messages = buildEnumProposalMessages(tableName, dictionary.tables[tableName]?.manual.businessName, candidates);
  const timeout = createLinkedTimeoutSignal(options.signal, ENUM_PROPOSAL_TIMEOUT_MS);
  try {
    const reply = await awaitWithAbort(deps.complete(messages, timeout.signal), timeout.signal);
    return { proposals: parseEnumProposals(reply, candidates), candidates };
  } catch (error) {
    if (timeout.didTimeout()) throw new Error('模型提议超时');
    throw error;
  } finally {
    timeout.dispose();
  }
}
