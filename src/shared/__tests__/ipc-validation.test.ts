import { describe, expect, it } from 'vitest';
import {
  MAX_AGENT_ATTACHMENTS,
  MAX_AGENT_MESSAGE_CHARS,
  parseAgentSendPayload,
  parsePermissionResponse,
  parseWindowKind,
  requireFiniteNumber,
} from '../ipc-validation';

describe('IPC runtime validation', () => {
  it('normalizes a valid agent payload', () => {
    expect(parseAgentSendPayload({
      sessionId: 'session-1',
      message: '',
      attachments: [{ relativePath: 'inbox/a.txt', originalName: 'a.txt', size: 12 }],
    })).toEqual({
      sessionId: 'session-1',
      message: '',
      attachments: [{ relativePath: 'inbox/a.txt', originalName: 'a.txt', size: 12 }],
    });
  });

  it('rejects malformed or unbounded agent payloads', () => {
    expect(() => parseAgentSendPayload(null)).toThrow('必须是对象');
    expect(() => parseAgentSendPayload({ message: '' })).toThrow('不能同时为空');
    expect(() => parseAgentSendPayload({ message: 'x'.repeat(MAX_AGENT_MESSAGE_CHARS + 1) }))
      .toThrow('长度限制');
    expect(() => parseAgentSendPayload({
      message: 'ok',
      attachments: Array.from({ length: MAX_AGENT_ATTACHMENTS + 1 }, () => ({})),
    })).toThrow('单次最多');
    expect(() => parseAgentSendPayload({
      message: 'ok',
      attachments: [{ relativePath: 'a', originalName: 'a', size: Number.NaN }],
    })).toThrow('有限数值');
  });

  it('accepts only declared window kinds and strict permission booleans', () => {
    expect(parseWindowKind('chat')).toBe('chat');
    expect(() => parseWindowKind('constructor')).toThrow('无效的窗口类型');
    expect(parsePermissionResponse({ requestId: 'r1', approved: false }))
      .toEqual({ requestId: 'r1', approved: false });
    expect(() => parsePermissionResponse({ requestId: 'r1', approved: 1 }))
      .toThrow('必须是布尔值');
  });

  it('rejects non-finite numbers and values outside the declared range', () => {
    expect(() => requireFiniteNumber(Number.POSITIVE_INFINITY, 'value')).toThrow('有限数值');
    expect(() => requireFiniteNumber(-1, 'value', { min: 0 })).toThrow('低于');
    expect(requireFiniteNumber(0.5, 'value', { min: 0, max: 1 })).toBe(0.5);
  });
});
