import { describe, expect, it } from 'vitest';
import {
  classifyMemoryKey,
  evaluateMemoryCandidate,
} from '../candidate-policy';

describe('memory candidate policy', () => {
  it('silently saves only high-confidence stable facts', () => {
    expect(evaluateMemoryCandidate({
      key: 'user.preference.drink',
      content: '用户喜欢拿铁',
      confidence: 0.95,
      reason: '用户明确表达',
    })).toMatchObject({
      category: 'stable_preference',
      decision: 'silent',
    });
  });

  it('requires confirmation for low-confidence or relationship facts', () => {
    expect(evaluateMemoryCandidate({
      key: 'user.habit.sleep',
      content: '用户可能喜欢晚睡',
      confidence: 0.7,
      reason: '模型推断',
    }).decision).toBe('confirm');
    expect(evaluateMemoryCandidate({
      key: 'user.relationship.trust',
      content: '用户把助手视为重要伙伴',
      confidence: 0.99,
      reason: '对话表达',
    }).decision).toBe('confirm');
  });

  it('never silently saves sensitive content or invalid keys', () => {
    expect(evaluateMemoryCandidate({
      key: 'user.preference.note',
      content: '用户的密码是 secret-123',
      confidence: 1,
      reason: '用户提到',
    }).decision).toBe('confirm');
    expect(evaluateMemoryCandidate({
      key: 'user.other.api_token',
      content: '一串凭据',
      confidence: 1,
      reason: '用户提到',
    }).decision).toBe('confirm');
    expect(evaluateMemoryCandidate({
      key: 'task.current',
      content: '正在整理文件',
      confidence: 1,
      reason: '临时上下文',
    }).decision).toBe('deny');
    expect(classifyMemoryKey('task.current')).toBeNull();
  });
});
