/**
 * 值定位（P7.2，计划 §3.13.2）：问题里的字面量（"华东"、"已退款"）先在字典的取值表 / 枚举含义里定位，
 * 命中才进过滤；定位不到就变成一条"范围过滤"追问，带候选选项。纯函数，不发请求。
 * 高基数列（没有取值表）的 LIKE 探测留到 P7.3。
 */
import { columnBusinessName, type DataDictionary } from './dictionary';
import { splitQualifiedColumn, type PlanUnresolved, type QueryPlan } from './query-plan';

export interface ValueLocation {
  column: string;
  original: string;
  resolved: string;
  how: 'exact' | 'label' | 'fuzzy';
}

export interface LocateResult {
  plan: QueryPlan;
  /** 给回复用的业务语言说明 */
  notes: string[];
  locations: ValueLocation[];
}

export const LOCATE_MAX_OPTIONS = 6;

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

/** 字符二元组重叠率，够用的近似度 */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const grams = (text: string) => {
    const set = new Set<string>();
    if (text.length === 1) set.add(text);
    for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
    return set;
  };
  const ga = grams(x);
  const gb = grams(y);
  let hit = 0;
  for (const gram of ga) if (gb.has(gram)) hit += 1;
  return hit / Math.max(ga.size, gb.size);
}

function candidatesFor(dictionary: DataDictionary, table: string, column: string): { values: string[]; labels: Record<string, string> } {
  const entry = dictionary.tables[table];
  const manual = entry?.columns[column];
  const auto = entry?.auto.columns.find((item) => item.name === column);
  const labels = manual?.enumValues ?? {};
  const values = new Set<string>([...(manual?.knownValues ?? auto?.knownValues ?? []), ...Object.keys(labels)]);
  return { values: [...values], labels };
}

function displayValue(labels: Record<string, string>, value: string): string {
  return labels[value] ? `${labels[value]}` : value;
}

export function locateFilterValues(plan: QueryPlan, dictionary: DataDictionary): LocateResult {
  const notes: string[] = [];
  const locations: ValueLocation[] = [];
  const unresolved: PlanUnresolved[] = [...plan.unresolved];
  const filters = plan.filters.map((filter) => {
    const { table, column } = splitQualifiedColumn(filter.column);
    const name = columnBusinessName(dictionary, table, column) ?? column;
    if (filter.op === 'like') {
      const values = filter.values.map((value) => (value.includes('%') ? value : `%${value}%`));
      return { ...filter, values };
    }
    if (filter.op !== 'eq' && filter.op !== 'in' && filter.op !== 'neq') return filter;
    const { values: candidates, labels } = candidatesFor(dictionary, table, column);
    if (!candidates.length) return filter;
    const resolvedValues: string[] = [];
    for (const original of filter.values) {
      if (candidates.includes(original)) {
        resolvedValues.push(original);
        locations.push({ column: filter.column, original, resolved: original, how: 'exact' });
        continue;
      }
      const byLabel = Object.entries(labels).find(([, label]) => normalize(label) === normalize(original));
      if (byLabel) {
        resolvedValues.push(byLabel[0]);
        locations.push({ column: filter.column, original, resolved: byLabel[0], how: 'label' });
        continue;
      }
      const scored = candidates
        .map((candidate) => ({ candidate, score: Math.max(similarity(candidate, original), similarity(displayValue(labels, candidate), original)) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      const runnerUp = scored[1];
      if (best && best.score >= 0.6 && (!runnerUp || runnerUp.score < best.score - 0.15)) {
        resolvedValues.push(best.candidate);
        locations.push({ column: filter.column, original, resolved: best.candidate, how: 'fuzzy' });
        notes.push(`「${original}」按${name}的登记值匹配为「${displayValue(labels, best.candidate)}」`);
        continue;
      }
      const options = scored
        .filter((item) => item.score > 0)
        .slice(0, LOCATE_MAX_OPTIONS)
        .map((item) => displayValue(labels, item.candidate));
      const fallback = candidates.slice(0, LOCATE_MAX_OPTIONS).map((candidate) => displayValue(labels, candidate));
      const question = `${name}里没有「${original}」这一项，你指的是哪一个？`;
      if (!unresolved.some((item) => item.question === question)) {
        unresolved.push({ slot: '范围过滤', question, options: [...(options.length ? options : fallback), '其他'] });
      }
      resolvedValues.push(original);
    }
    return { ...filter, values: resolvedValues };
  });
  return { plan: { ...plan, filters, unresolved }, notes, locations };
}
