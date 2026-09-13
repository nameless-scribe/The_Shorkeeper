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
    expect(evaluateMemoryCandidate({
      key: 'user.preference.shopping',
      content: '用户喜欢周末逛街',
      confidence: 0.95,
      reason: '用户明确表达',
    }).decision).toBe('silent');
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

  it('denies credentials and never silently saves sensitive content or invalid keys', () => {
    expect(evaluateMemoryCandidate({
      key: 'user.preference.note',
      content: '用户的密码是 secret-123',
      confidence: 1,
      reason: '用户提到',
    }).decision).toBe('deny');
    expect(evaluateMemoryCandidate({
      key: 'user.other.api_token',
      content: '一串凭据',
      confidence: 1,
      reason: '用户提到',
    }).decision).toBe('deny');
    expect(evaluateMemoryCandidate({
      key: 'user.other.favorite_place',
      content: '用户喜欢西湖',
      confidence: 1,
      reason: '旧版 key',
      memoryType: 'preference',
    }).decision).toBe('deny');
    expect(evaluateMemoryCandidate({
      key: 'task.current',
      content: '正在整理文件',
      confidence: 1,
      reason: '临时上下文',
    }).decision).toBe('deny');
    expect(classifyMemoryKey('task.current')).toBeNull();
  });

  it('normalizes the seven memory types and makes private facts explicit', () => {
    expect(evaluateMemoryCandidate({
      key: 'user.nickname',
      content: '用户希望被称为小汐',
      confidence: 0.99,
      reason: '明确要求',
    })).toMatchObject({ memoryType: 'identity', decision: 'confirm' });
    expect(evaluateMemoryCandidate({
      key: 'user.event.trip',
      content: '用户下周去杭州',
      confidence: 0.95,
      reason: '明确行程',
    })).toMatchObject({ memoryType: 'event', sensitivity: 'private', decision: 'confirm' });
    expect(evaluateMemoryCandidate({
      key: 'user.procedure.reports',
      content: '用户希望报告先给结论',
      confidence: 0.95,
      reason: '明确要求',
    })).toMatchObject({ memoryType: 'procedure', decision: 'silent' });
    expect(evaluateMemoryCandidate({
      key: 'user.procedure.health',
      content: '用户正在接受长期治疗',
      confidence: 0.95,
      reason: '明确说明',
    })).toMatchObject({
      memoryType: 'procedure',
      sensitivity: 'sensitive',
      modelUsePolicy: 'deny',
      decision: 'confirm',
    });
  });
});
