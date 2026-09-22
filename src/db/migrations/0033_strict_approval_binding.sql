-- 将高风险外部写入审批与具体调用、规范化参数和用户看到的预览版本绑定。
-- 旧审批记录保留为空，仅声明严格持久化审批的新工具要求这些字段齐全。

ALTER TABLE approvals ADD COLUMN args_digest TEXT;
ALTER TABLE approvals ADD COLUMN preview_revision TEXT;
ALTER TABLE approvals ADD COLUMN call_id TEXT;

CREATE INDEX IF NOT EXISTS idx_approvals_strict_binding
  ON approvals (run_id, call_id, tool_name, status);
