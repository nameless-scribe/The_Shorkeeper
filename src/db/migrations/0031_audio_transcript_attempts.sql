-- P4 稳定性：同一幂等键并发转写只能有一个计费请求，旧 attempt 不得覆盖新状态。

ALTER TABLE audio_transcripts ADD COLUMN attempt_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audio_transcripts_running_attempt
  ON audio_transcripts (status, attempt_id);
