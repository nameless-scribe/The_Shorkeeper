/**
 * P7 评测集无头运行（计划 §3.7、§11.6）：对真实库跑 docs/p7-eval/questions.json，输出通过率、追问次数、逃生口比例。
 * 走的是生产同一条码路（runOrchestrator + 内置工具 + 技能），调用模型、花钱、要真实库，**不进 pnpm test**。
 *
 * 前提：应用里已配置数据源并刷新过结构、模型 API 已配置。
 * 用法：
 *   pnpm test:p7:eval                      # 跑全部
 *   P7_EVAL_IDS=q01,q05 pnpm test:p7:eval  # 只跑指定问题
 *   P7_EVAL_SOURCE=生产库                   # 多个数据源时指定
 * 追问会由脚本自动作答：问题里的 `answers` 数组按顺序取，没有就选第一个选项。
 * 报告写到系统临时目录（路径打印在结尾）；回复正文只在报告里，不进仓库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from 'dotenv';
import { initDatabase } from '../src/db/index';
import { createSession, deleteSession } from '../src/db/repositories/sessions';
import { listDataSources } from '../src/db/repositories/datasources';
import { loadDictionary } from '../src/datasources/dictionary-store';
import { closeAllConnectors } from '../src/datasources/connector-registry';
import { parseEvalSet, type EvalQuestion } from '../src/datasources/eval-set';
import { containsTechnicalTerms } from '../src/datasources/plan-render';
import { runOrchestrator } from '../src/agent/orchestrator';
import { setPermissionConfirmer } from '../src/agent/permissions';
import { setUserQuestionResponder } from '../src/agent/user-questions';
import { getModelConfigSafe } from '../src/models/config';

config();

interface QuestionOutcome {
  id: string;
  question: string;
  passed: boolean;
  reasons: string[];
  asked: number;
  rawSql: boolean;
  executed: number;
  rowCount: number | null;
  durationMs: number;
  reply: string;
  toolCalls: string[];
}

function fail(message: string): never {
  console.error(`\n[p7:eval] ${message}\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  const db = await initDatabase();
  const raw = JSON.parse(fs.readFileSync(path.resolve('docs/p7-eval/questions.json'), 'utf-8')) as unknown;
  const parsed = parseEvalSet(raw);
  if ('error' in parsed) fail(`评测集格式错误：${parsed.error}`);
  for (const warning of parsed.warnings) console.warn(`[p7:eval] ${warning}`);
  const onlyIds = process.env.P7_EVAL_IDS?.split(',').map((id) => id.trim()).filter(Boolean);
  const questions = onlyIds?.length ? parsed.questions.filter((item) => onlyIds.includes(item.id)) : parsed.questions;
  if (!questions.length) fail('没有要跑的问题');

  if (!getModelConfigSafe()) fail('模型 API 未配置');
  const sources = listDataSources();
  const wanted = process.env.P7_EVAL_SOURCE?.trim();
  const source = wanted ? sources.find((item) => item.name === wanted || item.id === wanted) : sources[0];
  if (!source) fail(wanted ? `没有叫「${wanted}」的数据源` : '尚未配置数据源');
  const dictionary = loadDictionary(source.id);
  if (!Object.keys(dictionary.tables).length) fail(`数据源「${source.name}」还没有读取过结构，先在设置里刷新`);
  console.info(`[p7:eval] 数据源「${source.name}」，字典 ${Object.keys(dictionary.tables).length} 张表、${dictionary.metrics.length} 个指标；共 ${questions.length} 个问题`);

  // 权限一律批准（评测跑的是只读查询）；追问自动作答
  setPermissionConfirmer(async () => ({ approved: true, decidedBy: 'user' }));
  let currentAnswers: string[] = [];
  let asked = 0;
  setUserQuestionResponder(async (payload) => {
    asked += 1;
    const scripted = currentAnswers.shift();
    if (scripted) return { answer: scripted, decidedBy: 'user' };
    const first = payload.options[0];
    return first ? { answer: first.label, optionId: first.id, decidedBy: 'user' } : { answer: '按默认口径', decidedBy: 'user' };
  });

  const outcomes: QuestionOutcome[] = [];
  for (const item of questions) {
    const outcome = await runQuestion(item, db);
    outcomes.push(outcome);
    console.info(`[p7:eval] ${outcome.passed ? 'PASS' : 'FAIL'} ${item.id} 追问 ${outcome.asked} 次，执行 ${outcome.executed} 次${outcome.rawSql ? '，走了逃生口' : ''}，${outcome.durationMs} ms${outcome.reasons.length ? `：${outcome.reasons.join('；')}` : ''}`);
  }

  const passed = outcomes.filter((item) => item.passed).length;
  const escapes = outcomes.filter((item) => item.rawSql).length;
  const askedTotal = outcomes.reduce((sum, item) => sum + item.asked, 0);
  const summary = {
    source: source.name,
    total: outcomes.length,
    passed,
    passRate: Math.round((passed / outcomes.length) * 100),
    escapeRate: Math.round((escapes / outcomes.length) * 100),
    askedPerQuestion: Math.round((askedTotal / outcomes.length) * 100) / 100,
    ranAt: new Date().toISOString(),
  };
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-p7-eval-'));
  const reportPath = path.join(reportDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ summary, outcomes }, null, 2), 'utf-8');
  console.info(`\n[p7:eval] 通过 ${passed}/${outcomes.length}（${summary.passRate}%），逃生口 ${summary.escapeRate}%，平均追问 ${summary.askedPerQuestion} 次`);
  console.info(`[p7:eval] 报告：${reportPath}`);

  await closeAllConnectors();
  await db.closeAsync();
  process.exitCode = passed === outcomes.length ? 0 : 1;

  async function runQuestion(item: EvalQuestion, database: Awaited<ReturnType<typeof initDatabase>>): Promise<QuestionOutcome> {
    const session = createSession(database, `p7-eval ${item.id}`);
    asked = 0;
    currentAnswers = [...((item as EvalQuestion & { answers?: string[] }).answers ?? [])];
    const started = Date.now();
    let reply = '';
    const toolCalls: string[] = [];
    let executed = 0;
    let rawSql = false;
    let rowCount: number | null = null;
    let runError: string | null = null;
    const pendingCalls = new Map<string, { name: string; args: unknown }>();
    try {
      for await (const event of runOrchestrator(item.question, session.id, undefined, { persistMessages: true, kind: 'chat' })) {
        if (event.type === 'text_delta') reply += event.delta;
        else if (event.type === 'tool_call_start') {
          toolCalls.push(event.name);
          pendingCalls.set(event.callId, { name: event.name, args: event.args });
          if (event.name === 'run_sql_query') {
            const plan = (event.args as { plan?: { rawSql?: string } })?.plan;
            if (plan?.rawSql) rawSql = true;
          }
        } else if (event.type === 'tool_call_end') {
          const call = pendingCalls.get(event.callId);
          if (call?.name === 'run_sql_query' && event.result.success) {
            executed += 1;
            const count = (event.result.metadata as { rowCount?: number })?.rowCount;
            if (typeof count === 'number') rowCount = count;
          }
        } else if (event.type === 'run_error') {
          runError = event.message;
        }
      }
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        deleteSession(session.id, database);
      } catch {
        // 评测会话删不掉不影响结果
      }
    }

    const reasons: string[] = [];
    if (runError) reasons.push(`运行出错：${runError}`);
    if (item.expect.mustAsk && asked === 0) reasons.push('应先追问却直接给了结果');
    if (asked > 2) reasons.push(`追问了 ${asked} 次，超过 2 次`);
    if (!item.expect.mustAsk && executed === 0 && !runError) reasons.push('没有执行任何查询');
    for (const forbidden of item.expect.mustNotContain ?? []) {
      if (reply.includes(forbidden)) reasons.push(`回复里出现了「${forbidden}」`);
    }
    if (containsTechnicalTerms(reply)) reasons.push('回复里出现了 SQL 关键字或反引号');
    if (item.expect.rowCountBetween && rowCount !== null) {
      const [low, high] = item.expect.rowCountBetween;
      if (rowCount < low || rowCount > high) reasons.push(`行数 ${rowCount} 不在 [${low}, ${high}]`);
    }
    return {
      id: item.id,
      question: item.question,
      passed: reasons.length === 0,
      reasons,
      asked,
      rawSql,
      executed,
      rowCount,
      durationMs: Date.now() - started,
      reply,
      toolCalls,
    };
  }
}

void main().catch((error) => {
  console.error(`[p7:eval] 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
