-- P3 本地主动服务：事件账本、路由决策、投递记录与用户反馈。
-- 领域数据（待办、承诺、运行、定时任务、文档、记忆、目标）仍是唯一真源；
-- proactive_events 只保存由真源投影出的待处理提示，来源恢复后事件自动 resolved。

CREATE TABLE IF NOT EXISTS proactive_events (
  id TEXT PRIMARY KEY NOT NULL,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_ref TEXT,
  dedupe_key TEXT NOT NULL,
  source_version INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  summary TEXT,
  urgency TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  due_at INTEGER,
  occurred_at INTEGER NOT NULL,
  expires_at INTEGER,
  snoozed_until INTEGER,
  resolved_at INTEGER,
  resolved_reason TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (dedupe_key, source_version)
);

CREATE INDEX IF NOT EXISTS idx_proactive_events_status_occurred
  ON proactive_events (status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_events_source
  ON proactive_events (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_proactive_events_dedupe
  ON proactive_events (dedupe_key, status);

-- 路由决策：替代原先仅进程内保存的最近 50 条决策数组。
-- subject_kind 区分本地事件、显式定时提醒和每日管家完成提示；decision_key 保证重复调度不重复记账。
CREATE TABLE IF NOT EXISTS proactivity_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT,
  decision_key TEXT NOT NULL UNIQUE,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  policy TEXT NOT NULL,
  route TEXT NOT NULL,
  reason TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  evaluated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proactivity_decisions_subject
  ON proactivity_decisions (subject_kind, subject_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactivity_decisions_event
  ON proactivity_decisions (event_id);

-- 投递记录：跨重启的去重与频率预算依据。delivery_key 唯一，重复调度不能生成第二次弹窗。
CREATE TABLE IF NOT EXISTS proactivity_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT,
  delivery_key TEXT NOT NULL UNIQUE,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  scheduled_at INTEGER,
  sent_at INTEGER,
  error_category TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proactivity_deliveries_subject
  ON proactivity_deliveries (subject_kind, subject_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactivity_deliveries_channel_sent
  ON proactivity_deliveries (channel, status, sent_at DESC);

-- 用户反馈：只记录有限枚举动作与原因，不保存自由文本。
CREATE TABLE IF NOT EXISTS proactivity_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proactivity_feedback_event
  ON proactivity_feedback (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactivity_feedback_action
  ON proactivity_feedback (action, created_at DESC);

-- 定时任务的失败真源：此前执行失败只写日志，主动服务无法据此投影事件。
ALTER TABLE scheduled_tasks ADD COLUMN last_error TEXT;
ALTER TABLE scheduled_tasks ADD COLUMN last_error_at INTEGER;
ALTER TABLE scheduled_tasks ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
