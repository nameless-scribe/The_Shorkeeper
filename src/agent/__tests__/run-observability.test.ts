import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyRunError,
  clearRunDiagnosticsForTests,
  createRunTelemetry,
  getRunDiagnostic,
  listRunDiagnostics,
} from '../run-observability';

afterEach(() => {
  clearRunDiagnosticsForTests();
});

describe('run observability', () => {
  it('classifies operational errors without exposing raw messages', () => {
    expect(classifyRunError('模型请求超时')).toBe('timeout');
    expect(classifyRunError('权限被拒绝: write_file')).toBe('permission_denied');
    expect(classifyRunError('fetch failed')).toBe('network');
    expect(classifyRunError('数据库写入失败')).toBe('persistence');
  });

  it('emits a structured, aggregated terminal record', () => {
    let time = 100;
    const logger = vi.fn();
    const telemetry = createRunTelemetry({
      runId: 'run-1',
      sessionId: 'session-1',
      modelId: 'test-model',
      activeSkillIds: ['skill-a'],
      now: () => time,
      logger,
    });

    telemetry.recordPhase('running');
    telemetry.recordToolStart('call-1', 'read_file');
    time = 140;
    telemetry.recordToolEnd('call-1', true);
    telemetry.recordUsage(10, 5, 2);
    time = 180;
    const record = telemetry.finish('finished', 'finished');

    expect(record).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      modelId: 'test-model',
      activeSkillIds: ['skill-a'],
      phase: 'finished',
      durationMs: 80,
      toolCallCount: 1,
      toolFailureCount: 0,
      toolDurationMs: 40,
      promptTokens: 10,
      completionTokens: 5,
      cachedTokens: 2,
      activities: [{
        stage: 'tool',
        status: 'succeeded',
        name: 'read_file',
        durationMs: 40,
      }],
    });
    expect(logger).toHaveBeenCalledOnce();
  });

  it('records model, permission, and persistence activity outcomes', () => {
    const logger = vi.fn();
    const telemetry = createRunTelemetry({
      runId: 'run-3',
      sessionId: 'session-3',
      logger,
      now: () => 100,
    });

    telemetry.recordModelRoundStart(1);
    telemetry.recordModelRoundEnd(1, 'failed', '模型请求超时');
    const permissionId = telemetry.recordPermissionStart('write_file');
    telemetry.recordPermissionEnd(permissionId, 'cancelled', '已取消');
    const persistenceId = telemetry.recordPersistenceStart('assistant_message');
    telemetry.recordPersistenceEnd(persistenceId, 'failed', '数据库写入失败');

    const record = telemetry.finish('error', 'error', '数据库写入失败');
    expect(record.activities).toEqual([
      { stage: 'model', status: 'failed', name: 'round-1', durationMs: 0, errorCategory: 'timeout' },
      { stage: 'permission', status: 'cancelled', name: 'write_file', durationMs: 0 },
      { stage: 'persistence', status: 'failed', name: 'assistant_message', durationMs: 0, errorCategory: 'persistence' },
    ]);
  });

  it('logs only an error category', () => {
    const logger = vi.fn();
    const telemetry = createRunTelemetry({
      runId: 'run-2',
      sessionId: 'session-2',
      logger,
    });

    telemetry.finish('error', 'error', 'fetch failed，api_key=secret-value');

    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ errorCategory: 'network' }));
    expect(JSON.stringify(logger.mock.calls[0][0])).not.toContain('secret-value');
  });

  it('closes active activities as cancelled at terminal time', () => {
    const telemetry = createRunTelemetry({ runId: 'run-4', sessionId: 'session-4' });
    telemetry.recordModelRoundStart(1);

    const record = telemetry.finish('cancelled', 'cancelled', '已取消');

    expect(record.activities).toEqual([
      {
        stage: 'model',
        status: 'cancelled',
        name: 'round-1',
        durationMs: expect.any(Number),
      },
    ]);
    expect(record.activities[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps recent diagnostics queryable by run id', () => {
    const telemetry = createRunTelemetry({
      runId: 'run-query',
      sessionId: 'session-query',
      logger: vi.fn(),
    });
    telemetry.finish('error', 'error', '模型请求超时');

    expect(listRunDiagnostics()).toHaveLength(1);
    expect(getRunDiagnostic('run-query')).toMatchObject({
      runId: 'run-query',
      errorCategory: 'timeout',
    });
    expect(getRunDiagnostic('missing')).toBeNull();
  });
});
