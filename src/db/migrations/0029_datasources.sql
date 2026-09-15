-- P7 数据源查询：五张表。
-- 密码经 protectSecret 加密；query_runs 不存结果数据，只存产物路径与统计（计划 §3.6：结果从不保存）。
-- 样例值与取值表只在 data_dictionary.auto_json / manual_json 里，不进日志与运行记录。

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  -- 本版仅 mysql
  kind TEXT NOT NULL DEFAULT 'mysql',
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 3306,
  database_name TEXT NOT NULL,
  user TEXT NOT NULL,
  -- protectSecret 之后的密文
  password TEXT NOT NULL DEFAULT '',
  -- { ssl, timeZone, sampleValues, focusTables, ... }
  options_json TEXT NOT NULL DEFAULT '{}',
  last_ok_at INTEGER,
  last_error TEXT,
  -- 1 = 测试连接时发现账号有写权限（应换只读账号）；NULL = 未探测
  writable_account INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS data_dictionary (
  id TEXT PRIMARY KEY NOT NULL,
  data_source_id TEXT NOT NULL,
  -- `table` 或 `table.column`
  object_key TEXT NOT NULL,
  -- 抓取的骨架；刷新结构时整份替换
  auto_json TEXT NOT NULL DEFAULT '{}',
  -- 人工层；刷新结构时保留
  manual_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  UNIQUE (data_source_id, object_key)
);

CREATE INDEX IF NOT EXISTS idx_data_dictionary_source
  ON data_dictionary (data_source_id, object_key);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY NOT NULL,
  data_source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sql_fragment TEXT NOT NULL,
  grain TEXT,
  notes TEXT,
  -- user / query
  source TEXT NOT NULL DEFAULT 'user',
  updated_at INTEGER NOT NULL,
  UNIQUE (data_source_id, name)
);

CREATE TABLE IF NOT EXISTS named_queries (
  id TEXT PRIMARY KEY NOT NULL,
  data_source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  question TEXT NOT NULL,
  -- 方案 JSON；字面量已抽成参数槽位（计划 §3.6）
  plan_json TEXT NOT NULL,
  sql TEXT NOT NULL,
  notes TEXT,
  -- float32 向量，用于相似问题检索；没有嵌入模型时为 NULL
  question_embedding BLOB,
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_row_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_named_queries_source
  ON named_queries (data_source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS query_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  data_source_id TEXT NOT NULL,
  named_query_id TEXT,
  plan_json TEXT NOT NULL,
  sql TEXT NOT NULL,
  -- running / succeeded / failed / cancelled
  status TEXT NOT NULL DEFAULT 'running',
  row_count INTEGER,
  duration_ms INTEGER,
  artifact_path TEXT,
  -- 已翻译成人话并限长的失败原因；数据库原文只进运行记录的步骤错误
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_query_runs_source
  ON query_runs (data_source_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_runs_run
  ON query_runs (run_id);
