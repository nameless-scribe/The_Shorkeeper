/**
 * run_sql_query（P7.2，计划 §3.4、§3.5、§3.9、§3.13.3）：
 * 预览阶段编译方案、给出业务语言摘要（SQL 折叠在开发者详情里）；确认后 EXPLAIN → 执行 + 自检并行 → CSV 产物。
 * 自检不过、数据库报错、行数估计超阈值，都不给结果，把原因回给模型处理。
 * 执行部分抽成 executePreparedPlan，run_named_query（P7.5）复用。
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { ToolContext, ToolDefinition, ToolResult, ToolSideEffectContract } from '../types';
import { buildFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import { stalePreviewResult } from '../file/preview';
import { toCsv } from '../../datasources/csv';
import { columnBusinessName, type DataDictionary } from '../../datasources/dictionary';
import { describeMysqlError } from '../../datasources/mysql-helpers';
import { DEFAULT_MAX_ROWS, HARD_MAX_ROWS } from '../../datasources/mysql-connector';
import type { CompiledPlan } from '../../datasources/plan-compiler';
import { runCompiledQuery, type SelfCheckReport } from '../../datasources/query-runner';
import type { DataSourceInfo } from '../../db/repositories/datasources';
import { formatPreparedPlan, preparePlan, type PreparedPlan } from './plan-preparation';
import { PLAN_PARAMETER_DESCRIPTION } from './propose-query-plan';
import { getDataToolDeps, resolveSource } from './source-access';

export const RUN_SQL_QUERY_CONTRACT: ToolSideEffectContract = {
  risk: 'medium',
  idempotent: true,
  supportsPreview: true,
  reversible: 'none',
  evidence: 'artifact',
};

export const MAX_REPAIR_ATTEMPTS = 3;
export const PREVIEW_ROWS = 20;

function invalid(error: string, metadata?: Record<string, unknown>): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments', ...(metadata ? { metadata } : {}) };
}

export function planRevision(sourceId: string, compiled: CompiledPlan): string {
  const hash = createHash('sha256').update(JSON.stringify([sourceId, compiled.sql, compiled.params])).digest('hex');
  return `plan:${hash.slice(0, 32)}`;
}

function slug(text: string): string {
  const cleaned = text.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return [...cleaned].slice(0, 40).join('') || '查询';
}

/** 产物按日期命名，并带查询运行唯一后缀，避免同秒同摘要覆盖旧证据。 */
export function artifactPath(now: Date, subject: string, uniqueId: string): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = uniqueId.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 16) || randomUUID().slice(0, 8);
  return `查询/${date}/${time}-${slug(subject)}-${suffix}.csv`;
}

/** 结果列的业务名：指标列用指标名，字段与分组列查字典 */
export function businessColumnNames(compiled: CompiledPlan, columns: string[], dictionary: DataDictionary): string[] {
  return columns.map((name, index) => {
    const meta = compiled.columns[index];
    if ((meta?.kind === 'field' || meta?.kind === 'grain') && meta.table && meta.column) {
      return columnBusinessName(dictionary, meta.table, meta.column) ?? name;
    }
    return name;
  });
}

export function formatRowsTable(columns: string[], rows: unknown[][], max = PREVIEW_ROWS): string {
  const cell = (value: unknown) => (value == null ? '' : String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
  const lines = [`| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`];
  for (const row of rows.slice(0, max)) lines.push(`| ${row.map(cell).join(' | ')} |`);
  if (rows.length > max) lines.push(`（共 ${rows.length} 条，只显示前 ${max} 条；完整结果在产物文件里）`);
  return lines.join('\n');
}

function describeChecks(checks: SelfCheckReport): string[] {
  return checks.items.map((item) => `${item.ok === false ? '✗' : item.ok === null ? '·' : '✓'} ${item.label}：${item.detail}`);
}

export interface ExecuteOptions {
  maxRows: number;
  attempt: number;
  /** 回复要求之外附加的说明（如命名查询沿用了哪些槽位） */
  extraNotes?: string[];
  /** 成功后回调（命名查询记 last_run） */
  onSuccess?: (rowCount: number) => void;
}

/** 预览：业务语言摘要 + 折叠的 SQL，修订号是 sourceId + SQL + 参数的哈希 */
export function previewPreparedPlan(prepared: PreparedPlan, source: DataSourceInfo): ToolResult {
  const compiled = prepared.compiled!;
  const summary = prepared.rendering.summary;
  return {
    success: true,
    output: `预览：${summary}`,
    preview: {
      kind: 'query-plan',
      target: source.name,
      summary,
      revision: planRevision(source.id, compiled),
      details: [...prepared.rendering.lines, ...prepared.notes, ...prepared.warnings],
      technicalDetails: `${compiled.sql}\n-- 参数：${JSON.stringify(compiled.params)}`,
    },
  };
}

/** 确认后的执行：EXPLAIN → 阈值 → 主查询与自检并行 → CSV 产物 → 查询记录 */
export async function executePreparedPlan(
  prepared: PreparedPlan,
  source: DataSourceInfo,
  dictionary: DataDictionary,
  ctx: ToolContext,
  options: ExecuteOptions,
): Promise<ToolResult> {
  const deps = getDataToolDeps();
  const compiled = prepared.compiled!;
  const summary = prepared.rendering.summary;
  const revision = planRevision(source.id, compiled);
  if (ctx.previewRevision && ctx.previewRevision !== revision) return stalePreviewResult(source.name);

  const run = deps.startQueryRun({ runId: ctx.runId ?? null, sourceId: source.id, planJson: JSON.stringify(prepared.plan), sql: compiled.sql });
  const started = Date.now();
  let connector;
  try {
    connector = deps.getConnector(source.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run) deps.finishQueryRun(run.id, { status: 'failed', error: message });
    return { success: false, output: '', error: message, errorCategory: 'external_service_failure' };
  }

  const outcome = await runCompiledQuery(connector, compiled, prepared.plan.metrics, { maxRows: options.maxRows, signal: ctx.signal, skipExplain: false });
  const durationMs = Date.now() - started;

  if (outcome.status === 'db_error') {
    const friendly = describeMysqlError(Object.assign(new Error(outcome.message), { code: outcome.code }));
    if (run) deps.finishQueryRun(run.id, { status: 'failed', error: friendly, durationMs });
    const repairable = options.attempt < MAX_REPAIR_ATTEMPTS && !ctx.signal.aborted;
    return {
      success: false,
      output: '',
      error: repairable
        ? `数据库拒绝了这个查询（第 ${options.attempt} 次）。原文：${outcome.message}。请改写方案后带 attempt=${options.attempt + 1} 再试；回复用户时不要引用原文，说"详情在运行记录"`
        : `数据库连续 ${options.attempt} 次拒绝了查询，不再重试。给用户的说明：${friendly}（详情在运行记录）`,
      errorCategory: ctx.signal.aborted ? 'cancelled' : 'external_service_failure',
      metadata: { phase: outcome.phase, dbError: outcome.message, code: outcome.code, attempt: options.attempt, repairable, sql: compiled.sql },
    };
  }
  if (outcome.status === 'too_many_rows') {
    if (run) deps.finishQueryRun(run.id, { status: 'failed', error: `预计扫描约 ${outcome.estimatedRows} 行，超过阈值`, durationMs });
    return invalid(
      `这个查询预计要扫描约 ${Math.round(outcome.estimatedRows / 10_000)} 万行，太重了。先用 ask_user 请用户缩小时间范围或加过滤条件，再重新提方案`,
      { estimatedRows: outcome.estimatedRows, sql: compiled.sql },
    );
  }
  if (outcome.status === 'check_failed') {
    if (run) deps.finishQueryRun(run.id, { status: 'failed', error: '结果自检未通过：分组合计与整体合计不一致', durationMs });
    return {
      success: false,
      output: '',
      error: `结果自检没通过，已拦下，不要把它给用户：${describeChecks(outcome.checks).join('；')}。多半是连接放大或分组重复，检查维度连接的基数与分组列后重新提方案；改不了就如实告诉用户"合计对不上，这次算不准"`,
      errorCategory: 'internal_error',
      metadata: { checks: outcome.checks, sql: compiled.sql, durationMs },
    };
  }

  const { result, checks, estimatedRows } = outcome;
  const columnNames = businessColumnNames(compiled, result.columns, dictionary);
  const relativePath = artifactPath(deps.now(), summary.slice(0, 12), run?.id ?? randomUUID());
  const csv = toCsv(columnNames, result.rows);
  let artifact;
  try {
    await writeWorkspaceFileAtomically(ctx.workspaceRoot, relativePath, (temporaryPath) => fs.writeFile(temporaryPath, csv, 'utf-8'));
    artifact = await buildFileArtifact(ctx.workspaceRoot, relativePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run) deps.finishQueryRun(run.id, { status: 'failed', error: `结果文件写入失败：${message}`, durationMs });
    return { success: false, output: '', error: `查询成功但结果文件没写成：${message}` };
  }
  if (run) deps.finishQueryRun(run.id, { status: 'succeeded', rowCount: result.rows.length, durationMs, artifactPath: relativePath });
  options.onSuccess?.(result.rows.length);

  const notes = [...prepared.notes, ...checks.notes, ...(options.extraNotes ?? [])];
  if (result.truncated && !checks.notes.some((note) => note.includes('只列了'))) notes.push(`结果超过 ${options.maxRows} 条，只取了前 ${options.maxRows} 条`);
  const output = [
    `方案：${summary}`,
    `结果：${result.rows.length} 条${result.truncated ? '（已截断）' : ''}，完整结果在 ${relativePath}`,
    formatRowsTable(columnNames, result.rows),
    ...(notes.length ? [`说明：${notes.join('；')}`] : []),
    '回复要求：先一两句话说结论，再给表或要点，最后一句说文件在哪；不要出现表名、列名、SQL；用了默认口径要说明。要 Excel 或图表就用 export_query_result 处理这个文件。',
  ].join('\n');
  return {
    success: true,
    output,
    metadata: {
      sourceId: source.id,
      rowCount: result.rows.length,
      truncated: result.truncated,
      durationMs: result.durationMs,
      estimatedRows,
      checks,
      sql: compiled.sql,
      params: compiled.params,
      raw: compiled.raw,
      list: compiled.list,
      columns: columnNames,
      runRecordId: run?.id ?? null,
      artifactPath: relativePath,
    },
    artifacts: [artifact],
  };
}

export function clampMaxRows(value: unknown, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(HARD_MAX_ROWS, Math.floor(number)));
}

export function attemptNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

export const runSqlQueryTool: ToolDefinition = {
  name: 'run_sql_query',
  description:
    '执行一份已确认的查询方案（propose_query_plan 返回的 plan 原样传入）：只读，先估算代价再执行并自动核对，完整结果落成工作区 CSV，返回前 20 行与业务语言摘要。回复里不要出现 SQL、表名、列名',
  category: 'doc',
  requiresPermission: ['filesystem:write'],
  sideEffects: RUN_SQL_QUERY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源名称或 id；只有一个时可省略' },
      plan: { type: 'object', description: PLAN_PARAMETER_DESCRIPTION },
      max_rows: { type: 'number', description: `最多返回多少行（默认 ${DEFAULT_MAX_ROWS}，上限 ${HARD_MAX_ROWS}）` },
      attempt: { type: 'number', description: `数据库报错后改写重试时填第几次（1 起），最多 ${MAX_REPAIR_ATTEMPTS} 次` },
    },
    required: ['plan'],
  },
  async execute(args, ctx) {
    const { source: ref, plan, max_rows, attempt } = (args ?? {}) as { source?: string; plan?: unknown; max_rows?: number; attempt?: number };
    if (!plan || typeof plan !== 'object') return invalid('缺少 plan（方案对象）');
    const deps = getDataToolDeps();
    const resolved = resolveSource(ref, deps);
    if ('error' in resolved) return invalid(resolved.error);
    const source = resolved.source;
    const dictionary = deps.loadDictionary(source.id);
    const preparedResult = preparePlan(plan, source.id, dictionary);
    if (!preparedResult.ok) return invalid(preparedResult.error);
    const prepared: PreparedPlan = preparedResult.prepared;
    if (!prepared.ready || !prepared.compiled) {
      return invalid(
        prepared.compileError
          ? `方案编不出来：${prepared.compileError}`
          : `方案还不能执行（有未确定项或未登记的指标）；先用 propose_query_plan 处理：\n${formatPreparedPlan(prepared)}`,
      );
    }
    if (ctx.preview) return previewPreparedPlan(prepared, source);
    return executePreparedPlan(prepared, source, dictionary, ctx, {
      maxRows: clampMaxRows(max_rows, prepared.plan.limit),
      attempt: attemptNumber(attempt),
    });
  },
};
