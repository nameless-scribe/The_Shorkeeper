/**
 * 关注表超过 60 张时按问题挑表（P7.2，计划 §3.1 / §10）。
 * 第一版用关键词与字符二元组打分，不建向量索引：表名、业务名、说明、列的业务名与注释都参与；
 * 打分为 0 的表不给。命中不足时补关注表里靠前的几张，保证模型总有表可看。
 */
import { CATALOG_MAX_TABLES, focusedTables, type DataDictionary } from './dictionary';

export interface TableMatch {
  table: string;
  score: number;
}

function grams(text: string): Set<string> {
  const normalized = text.replace(/\s+/g, '').toLowerCase();
  const set = new Set<string>();
  for (const word of normalized.match(/[a-z0-9_]{2,}/g) ?? []) set.add(word);
  const cjk = normalized.replace(/[^一-鿿]/g, '');
  for (let i = 0; i < cjk.length - 1; i += 1) set.add(cjk.slice(i, i + 2));
  return set;
}

export function scoreTableForQuestion(dictionary: DataDictionary, table: string, questionGrams: Set<string>): number {
  const entry = dictionary.tables[table];
  if (!entry) return 0;
  const weighted: Array<[string, number]> = [
    [entry.manual.businessName ?? '', 3],
    [entry.manual.description ?? '', 2],
    [entry.auto.comment ?? '', 2],
    [table.replace(/_/g, ' '), 1],
  ];
  for (const column of entry.auto.columns) {
    const manual = entry.columns[column.name];
    weighted.push([manual?.businessName ?? '', 1.5], [column.comment ?? '', 1], [column.name.replace(/_/g, ' '), 0.5]);
  }
  let score = 0;
  for (const [text, weight] of weighted) {
    if (!text) continue;
    for (const gram of grams(text)) if (questionGrams.has(gram)) score += weight;
  }
  return score;
}

/** 返回最多 max 张表：命中的按分数排，不够时用关注表补齐 */
export function pickTablesForQuestion(dictionary: DataDictionary, question: string, max = CATALOG_MAX_TABLES): TableMatch[] {
  const questionGrams = grams(question);
  const pool = focusedTables(dictionary);
  const scored = pool
    .map((table) => ({ table, score: scoreTableForQuestion(dictionary, table, questionGrams) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.table.localeCompare(b.table));
  const picked = scored.slice(0, max);
  if (picked.length < max) {
    const chosen = new Set(picked.map((item) => item.table));
    for (const table of pool) {
      if (picked.length >= max) break;
      if (!chosen.has(table)) picked.push({ table, score: 0 });
    }
  }
  return picked;
}
