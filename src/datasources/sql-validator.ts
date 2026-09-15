/**
 * 只读 SQL 校验器（P7.0，计划 §3.4）。
 *
 * 保守的拒绝器，不是解析器：宁可拒绝一条合法的复杂查询让模型改写。
 * 连接层本身是只读会话，这里是第二道门；任何路径都不能把非 SELECT 发到数据库。
 */

export interface SqlValidationOk {
  ok: true;
  /** 规范化后的 SQL：去掉尾部分号，必要时追加 LIMIT */
  sql: string;
  /** 实际生效的上限 */
  limit: number;
  /** 不拒绝但要求方案说明的问题 */
  warnings: string[];
}

export interface SqlValidationError {
  ok: false;
  error: string;
}

export type SqlValidationResult = SqlValidationOk | SqlValidationError;

export const SQL_DEFAULT_LIMIT = 500;
export const SQL_MAX_LIMIT = 5000;

const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
  'GRANT', 'REVOKE', 'CALL', 'LOAD_FILE', 'OUTFILE', 'DUMPFILE', 'HANDLER', 'LOCK',
  'SET', 'USE', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'FLUSH', 'KILL', 'RESET', 'PREPARE', 'EXECUTE',
];

const AGGREGATE_FUNCTIONS = /\b(SUM|COUNT|AVG|MIN|MAX|GROUP_CONCAT)\s*\(/i;

/** 把字符串字面量抹成空串，之后再找关键字，避免字面量里的 "delete" 误报或被用来绕过 */
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
}

/**
 * WITH 主体的第一个关键字：按括号深度扫过 `name AS (...)[, name AS (...)]` 列表，
 * 深度回到 0 且下一个非空字符不是逗号时，后面的词就是主体。
 */
function withBodyKeyword(stripped: string): string {
  let depth = 0;
  let index = stripped.search(/WITH/i) + 4;
  for (; index < stripped.length; index += 1) {
    const ch = stripped[index];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        const rest = stripped.slice(index + 1);
        const next = /^\s*(,|\w+)/.exec(rest)?.[1] ?? '';
        if (next === ',') continue;
        return next.toUpperCase();
      }
    }
  }
  return '';
}

export function clampSqlLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return SQL_DEFAULT_LIMIT;
  return Math.max(1, Math.min(SQL_MAX_LIMIT, Math.floor(value)));
}

/**
 * 校验并规范化。maxRows 为调用方希望的上限（缺省 500，封顶 5000）：
 * SQL 自带 LIMIT 时取两者较小；没有就追加。
 */
export function validateReadOnlySql(rawSql: string, maxRows?: number): SqlValidationResult {
  if (typeof rawSql !== 'string' || !rawSql.trim()) return { ok: false, error: 'SQL 为空' };
  let sql = rawSql.trim().replace(/;\s*$/, '');
  if (sql.length > 20_000) return { ok: false, error: 'SQL 过长（上限 20000 字符）' };

  const stripped = stripStringLiterals(sql);
  if (/--|#|\/\*/.test(stripped)) return { ok: false, error: '不允许注释（-- # /*）' };
  if (stripped.includes(';')) return { ok: false, error: '只允许一条语句' };
  if (/\\/.test(stripped)) return { ok: false, error: '字面量之外不允许反斜杠' };
  if (/\bINTO\b/i.test(stripped)) return { ok: false, error: '不允许 INTO（SELECT … INTO / INSERT INTO）' };
  if (/\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i.test(stripped)) {
    return { ok: false, error: '不允许加锁读取' };
  }

  const firstWord = /^\s*(\w+)/.exec(stripped)?.[1]?.toUpperCase() ?? '';
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    return { ok: false, error: `只允许 SELECT 或 WITH 开头，收到的是 ${firstWord || '空'}` };
  }
  if (firstWord === 'WITH') {
    const bodyWord = withBodyKeyword(stripped);
    if (bodyWord !== 'SELECT') return { ok: false, error: 'WITH 的主体必须是 SELECT' };
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    if (pattern.test(stripped)) return { ok: false, error: `不允许的关键字：${keyword}` };
  }

  const warnings: string[] = [];
  if (/\bJOIN\b/i.test(stripped) && AGGREGATE_FUNCTIONS.test(stripped)
    && !/\bDISTINCT\b/i.test(stripped) && !/\(\s*SELECT\b/i.test(stripped)) {
    warnings.push('JOIN 后直接聚合且没有 DISTINCT 或子查询分组，一对多连接会放大指标；方案里须说明粒度');
  }

  const requested = clampSqlLimit(maxRows);
  const existing = /\bLIMIT\s+(\d+)(?:\s*,\s*(\d+))?\s*$/i.exec(stripped);
  let limit = requested;
  if (existing) {
    const own = Number(existing[2] ?? existing[1]);
    limit = Math.min(requested, Number.isFinite(own) && own > 0 ? own : requested);
    sql = sql.replace(/\bLIMIT\s+\d+(?:\s*,\s*\d+)?\s*$/i, `LIMIT ${limit}`);
  } else {
    sql = `${sql} LIMIT ${limit}`;
  }
  return { ok: true, sql, limit, warnings };
}

/** 逃生口：模型直接写的 SQL 统一包一层再限行，不解析内部 LIMIT。 */
export function wrapRawSql(sql: string, limit: number): string {
  const inner = sql.trim().replace(/;\s*$/, '');
  return `SELECT * FROM (${inner}) AS _q LIMIT ${clampSqlLimit(limit)}`;
}
