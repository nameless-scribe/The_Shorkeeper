import { describe, expect, it } from 'vitest';
import { formatRunErrorForUser, getRunRecoveryAdvice } from '../run-errors';

describe('run error presentation', () => {
  it('adds recovery advice and the run id', () => {
    expect(formatRunErrorForUser('模型请求超时', 'run-123')).toBe(
      '模型请求超时\n建议：请稍后重试；若持续发生，请检查模型服务或相关工具是否可用。\n运行编号：run-123',
    );
  });

  it('keeps cancellation concise', () => {
    expect(formatRunErrorForUser('AbortError: cancelled', 'run-123')).toBe('已取消');
    expect(getRunRecoveryAdvice('cancelled')).toBeNull();
  });
});
