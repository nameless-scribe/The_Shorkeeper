import { describe, expect, it } from 'vitest';
import { formatRunErrorForUser, getRunRecoveryAdvice } from '../run-errors';

describe('run error presentation', () => {
  it.each(['已达到本段工具调用预算 (120)', '尚未收到必要回答，已停止本批后续操作', '相同工具和参数连续失败 3 次，已停止重复尝试', '模型输出达到长度上限', '副作用结果未知，请先核对目标状态'])('does not encourage blind retry after %s', (message) => {
    const formatted = formatRunErrorForUser(message, 'r');
    expect(formatted).toContain('先核对阶段摘要和已有产物');
    expect(formatted).toContain('不会自动从断点续跑');
    expect(formatted).not.toContain('可重试此操作');
  });
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
