/**
 * 评测集（P7.0，计划 §3.7、§11.6）：`docs/p7-eval/questions.json` 的格式校验。
 * 用户先只写问题与期望要点；无头运行器在 P7.2 接上真实库。
 */

export interface EvalExpectation {
  /** 期望的方案槽位要点（业务语言），如 { 指标: '销售额', 时间范围: '2026 年 8 月' } */
  slots?: Record<string, string>;
  rowCountBetween?: [number, number];
  aggregate?: { column: string; equalsQueryName: string };
  /** 这个问题笼统，期望助理先追问 */
  mustAsk?: boolean;
  /** 回复里不得出现的字符串（表名、列名、SQL 关键字） */
  mustNotContain?: string[];
}

export interface EvalQuestion {
  id: string;
  question: string;
  expect: EvalExpectation;
  notes?: string;
}

/** 首轮真实库基线使用用户确认的 10 个问题；后续可按真实使用自然扩充。 */
export const EVAL_MIN_QUESTIONS = 10;
export const EVAL_MIN_VAGUE = 4;

type Parsed = { questions: EvalQuestion[]; warnings: string[] } | { error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseEvalSet(value: unknown): Parsed {
  if (!Array.isArray(value)) return { error: '评测集必须是数组' };
  const questions: EvalQuestion[] = [];
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return { error: `第 ${index + 1} 项不是对象` };
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) return { error: `第 ${index + 1} 项缺少 id` };
    if (ids.has(id)) return { error: `id 重复：${id}` };
    ids.add(id);
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    if (!question) return { error: `${id} 缺少 question` };
    const rawExpect = item.expect;
    if (rawExpect !== undefined && !isRecord(rawExpect)) return { error: `${id} 的 expect 必须是对象` };
    const expect: EvalExpectation = {};
    if (rawExpect) {
      if (rawExpect.slots !== undefined) {
        if (!isRecord(rawExpect.slots) || Object.values(rawExpect.slots).some((v) => typeof v !== 'string')) {
          return { error: `${id} 的 expect.slots 须为字符串映射` };
        }
        expect.slots = rawExpect.slots as Record<string, string>;
      }
      if (rawExpect.rowCountBetween !== undefined) {
        const range = rawExpect.rowCountBetween;
        if (!Array.isArray(range) || range.length !== 2 || range.some((n) => typeof n !== 'number' || n < 0) || range[0] > range[1]) {
          return { error: `${id} 的 expect.rowCountBetween 须为 [下限, 上限]` };
        }
        expect.rowCountBetween = [range[0], range[1]];
      }
      if (rawExpect.aggregate !== undefined) {
        const agg = rawExpect.aggregate;
        if (!isRecord(agg) || typeof agg.column !== 'string' || typeof agg.equalsQueryName !== 'string') {
          return { error: `${id} 的 expect.aggregate 须含 column 与 equalsQueryName` };
        }
        expect.aggregate = { column: agg.column, equalsQueryName: agg.equalsQueryName };
      }
      if (rawExpect.mustAsk !== undefined) {
        if (typeof rawExpect.mustAsk !== 'boolean') return { error: `${id} 的 expect.mustAsk 须为布尔值` };
        expect.mustAsk = rawExpect.mustAsk;
      }
      if (rawExpect.mustNotContain !== undefined) {
        if (!Array.isArray(rawExpect.mustNotContain) || rawExpect.mustNotContain.some((s) => typeof s !== 'string')) {
          return { error: `${id} 的 expect.mustNotContain 须为字符串数组` };
        }
        expect.mustNotContain = rawExpect.mustNotContain as string[];
      }
    }
    const notes = typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : undefined;
    questions.push({ id, question, expect, ...(notes ? { notes } : {}) });
  }
  const warnings: string[] = [];
  if (questions.length < EVAL_MIN_QUESTIONS) warnings.push(`评测集只有 ${questions.length} 个问题，计划要求至少 ${EVAL_MIN_QUESTIONS} 个`);
  const vague = questions.filter((item) => item.expect.mustAsk).length;
  if (vague < EVAL_MIN_VAGUE) warnings.push(`笼统问题（mustAsk）只有 ${vague} 个，计划要求至少 ${EVAL_MIN_VAGUE} 个`);
  return { questions, warnings };
}
