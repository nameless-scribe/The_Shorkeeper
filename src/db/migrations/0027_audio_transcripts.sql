-- P4 录音转写账本。
-- 只记录"哪个音频转写过、产物在哪"，**不存逐字稿正文**——正文落工作区文件，
-- 理由同 P1：账本不复制正文，一小时会议的逐字稿轻松上万字。
--
-- 没有 provider_task_id，也没有 pending 状态：所选的极速版是同步接口，
-- 请求发出即在等结果，不存在"已提交但尚未开始"的中间态，也没有跨重启恢复问题。

CREATE TABLE IF NOT EXISTS audio_transcripts (
  id TEXT PRIMARY KEY NOT NULL,
  -- 音频在工作区里的相对路径
  source_path TEXT NOT NULL,
  -- 音频内容 SHA-256。幂等键：同一文件在同一设置下不重复转写，避免重复计费
  source_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  -- 供应商与引擎，便于日后换供应商时区分历史记录
  provider TEXT NOT NULL DEFAULT 'tencent-flash',
  engine_type TEXT NOT NULL,
  diarization INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running',
  -- 逐字稿产物的工作区相对路径
  transcript_path TEXT,
  sentence_count INTEGER,
  speaker_count INTEGER,
  -- 失败原因，已翻译成人话并限长
  error TEXT,
  provider_code INTEGER,
  provider_request_id TEXT,
  -- 录音属于敏感内容，默认从严；见 P4 计划 4.4
  sensitivity TEXT NOT NULL DEFAULT 'sensitive',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  -- 幂等的粒度：同一文件在不同引擎或分离开关下结果不同，不能互相复用
  UNIQUE (source_hash, engine_type, diarization)
);

CREATE INDEX IF NOT EXISTS idx_audio_transcripts_status_updated
  ON audio_transcripts (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_audio_transcripts_source_path
  ON audio_transcripts (source_path);
