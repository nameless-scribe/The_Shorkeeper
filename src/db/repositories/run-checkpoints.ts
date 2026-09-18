import { randomUUID } from 'node:crypto';
import { getDatabase, type AppDatabase } from '../index';
import type { TaskRunCheckpointRow } from '../schema';
import type { RunCheckpointInfo } from '../../shared/types';
import { isProtectedSecret, protectSecret, revealSecret } from '../../security/secret-storage';
import { CHECKPOINT_TTL_MS, CHECKPOINT_MAX_SEGMENTS, parseCheckpoint, type RunCheckpoint } from '../../agent/checkpoint-contract';

function eligible(runId: string, sessionId: string, db: AppDatabase): boolean {
  const run = db.prepare('SELECT phase, terminal_reason FROM task_runs WHERE id = ? AND session_id = ?').get(runId, sessionId);
  return run?.phase === 'error' && run.terminal_reason === 'budget_exhausted';
}

export function saveRunCheckpoint(runId: string, sessionId: string, checkpoint: RunCheckpoint, db: AppDatabase = getDatabase()): string {
  const serialized = JSON.stringify(checkpoint);
  parseCheckpoint(serialized);
  const payload = protectSecret(serialized);
  // 不允许 safeStorage 不可用时静默回退成明文。
  if (!isProtectedSecret(payload)) throw new Error('系统加密不可用，未保存续跑检查点');
  const id = randomUUID();
  db.transaction(() => {
    const run = db.prepare('SELECT phase FROM task_runs WHERE id = ? AND session_id = ?').get(runId, sessionId);
    if (run?.phase !== 'finalizing') throw new Error('运行不在可保存检查点的阶段');
    if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId)) throw new Error('会话不存在');
    if (db.prepare("SELECT id FROM task_run_steps WHERE run_id = ? AND status IN ('running', 'interrupted') LIMIT 1").get(runId)) throw new Error('存在未收尾的工具步骤');
    db.prepare('DELETE FROM task_run_checkpoints WHERE expires_at <= ?').run(Date.now());
    db.prepare(`INSERT INTO task_run_checkpoints (id, run_id, session_id, root_run_id, payload, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, runId, sessionId, checkpoint.rootRunId, payload, Date.now(), Date.now() + CHECKPOINT_TTL_MS);
    const saved = db.prepare('SELECT payload FROM task_run_checkpoints WHERE id = ?').get(id);
    if (saved?.payload !== payload) throw new Error('检查点写入校验失败');
  });
  return id;
}

export function getRunCheckpointInfo(runId: string, db: AppDatabase = getDatabase()): RunCheckpointInfo | null {
  db.prepare('DELETE FROM task_run_checkpoints WHERE expires_at <= ?').run(Date.now());
  const row = db.prepare('SELECT * FROM task_run_checkpoints WHERE run_id = ?').get(runId) as unknown as TaskRunCheckpointRow | undefined;
  if (!row) return null;
  let totals: RunCheckpoint['totals'] | undefined;
  try { if (isProtectedSecret(row.payload)) totals = parseCheckpoint(revealSecret(row.payload)).totals; }
  catch { /* 加密状态不可恢复时不开放继续；不把密文或原文错误送往 renderer。 */ }
  const chainExhausted = Boolean(totals && totals.segments >= CHECKPOINT_MAX_SEGMENTS);
  return { id: row.id, runId: row.run_id, rootRunId: row.root_run_id, expiresAt: row.expires_at,
    claimedRunId: row.claimed_run_id, totals,
    unavailableReason: !totals ? '检查点无法解密或格式不兼容，请重新确认任务'
      : chainExhausted ? '本任务已执行 10 段，请整理结果后重新确认任务范围'
      : !eligible(row.run_id, row.session_id, db) ? '原运行未完成可靠收尾，不能从此检查点继续' : undefined,
    available: Boolean(totals) && !chainExhausted && !row.claimed_run_id && row.expires_at > Date.now() && eligible(row.run_id, row.session_id, db) };
}

export function readRunCheckpoint(id: string, sessionId: string, db: AppDatabase = getDatabase()): RunCheckpoint {
  const row = db.prepare('SELECT * FROM task_run_checkpoints WHERE id = ? AND session_id = ?').get(id, sessionId) as unknown as TaskRunCheckpointRow | undefined;
  if (!row || row.claimed_run_id || row.expires_at <= Date.now() || !eligible(row.run_id, sessionId, db)) throw new Error('检查点已使用、已过期或运行不可继续');
  if (!isProtectedSecret(row.payload)) throw new Error('检查点加密格式无效');
  const snapshot = parseCheckpoint(revealSecret(row.payload));
  if (snapshot.totals.segments >= CHECKPOINT_MAX_SEGMENTS) throw new Error('本任务已执行 10 段，请整理结果后重新确认任务范围');
  return snapshot;
}

/** 在已有会话锁内调用；事务再防跨入口重复认领。认领后失败也不自动释放。 */
export function claimRunCheckpoint(id: string, sessionId: string, childRunId: string, db: AppDatabase = getDatabase()): void {
  db.transaction(() => {
    readRunCheckpoint(id, sessionId, db);
    const child = db.prepare('SELECT session_id, phase FROM task_runs WHERE id = ?').get(childRunId);
    if (child?.session_id !== sessionId || child.phase !== 'running') throw new Error('续跑运行未可靠记录');
    db.prepare('UPDATE task_run_checkpoints SET claimed_run_id = ? WHERE id = ? AND claimed_run_id IS NULL').run(childRunId, id);
    if (db.prepare('SELECT claimed_run_id FROM task_run_checkpoints WHERE id = ?').get(id)?.claimed_run_id !== childRunId) throw new Error('检查点认领失败');
  });
}
