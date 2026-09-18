import { describe, expect, it } from 'vitest';
import {
  MAX_AGENT_ATTACHMENTS,
  MAX_AGENT_MESSAGE_CHARS,
  MAX_WORKSPACE_ATTACHMENT_BYTES,
  MAX_WORKSPACE_AUDIO_ATTACHMENT_BYTES,
  parseAgentSendPayload,
  parsePermissionResponse,
  parseUserQuestionResponse,
  parseWindowKind,
  requireFiniteNumber,
} from '../ipc-validation';

describe('IPC runtime validation', () => {
  it('accepts explicit continuation only with a session, bounded checkpoint ID and unchanged task', () => {
    const payload = { sessionId: 's', message: '确认继续一段', resumeCheckpointId: 'cp' };
    expect(parseAgentSendPayload(payload).resumeCheckpointId).toBe('cp');
    for (const invalid of [
      { ...payload, sessionId: undefined }, { ...payload, resumeCheckpointId: {} },
      { ...payload, resumeCheckpointId: 'x'.repeat(201) }, { ...payload, message: '改成删除文件' },
      { ...payload, resumeCheckpointId: '   ' },
      { ...payload, attachments: [{ relativePath: 'a.txt', originalName: 'a.txt', size: 1 }] },
    ]) expect(() => parseAgentSendPayload(invalid)).toThrow();
  });
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

  it('lets audio attachments exceed the document size cap but nothing else', () => {
    const big = MAX_WORKSPACE_ATTACHMENT_BYTES + 1;
    const audio = parseAgentSendPayload({
      message: '',
      attachments: [{ relativePath: 'a.m4a', originalName: 'a.m4a', size: big, kind: 'audio' }],
    });
    expect(audio.attachments?.[0]).toEqual({ relativePath: 'a.m4a', originalName: 'a.m4a', size: big, kind: 'audio' });

    expect(() => parseAgentSendPayload({
      message: '',
      attachments: [{ relativePath: 'a.md', originalName: 'a.md', size: big, kind: 'text' }],
    })).toThrow();
    expect(() => parseAgentSendPayload({
      message: '',
      attachments: [{ relativePath: 'a.md', originalName: 'a.md', size: big }],
    })).toThrow();
    expect(() => parseAgentSendPayload({
      message: '',
      attachments: [{ relativePath: 'a.m4a', originalName: 'a.m4a', size: MAX_WORKSPACE_AUDIO_ATTACHMENT_BYTES + 1, kind: 'audio' }],
    })).toThrow();
    expect(() => parseAgentSendPayload({
      message: '',
      attachments: [{ relativePath: 'a.m4a', originalName: 'a.m4a', size: 1, kind: 'video' }],
    })).toThrow();
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

  it('accepts option, free-text and dismissed question responses but never an empty one', () => {
    expect(parseUserQuestionResponse({ requestId: 'q1', optionId: 'a' })).toEqual({ requestId: 'q1', optionId: 'a' });
    expect(parseUserQuestionResponse({ requestId: 'q1', answer: ' 明天 ' })).toEqual({ requestId: 'q1', answer: ' 明天 ' });
    expect(parseUserQuestionResponse({ requestId: 'q1', dismissed: true })).toEqual({ requestId: 'q1', dismissed: true });
    expect(() => parseUserQuestionResponse({ requestId: 'q1', answer: '   ' })).toThrow('回答不能为空');
    expect(() => parseUserQuestionResponse({ requestId: 'q1' })).toThrow('回答不能为空');
    expect(() => parseUserQuestionResponse({ requestId: 'q1', optionId: 'x'.repeat(41) })).toThrow();
    expect(() => parseUserQuestionResponse({ optionId: 'a' })).toThrow();
  });

  it('rejects non-finite numbers and values outside the declared range', () => {
    expect(() => requireFiniteNumber(Number.POSITIVE_INFINITY, 'value')).toThrow('有限数值');
    expect(() => requireFiniteNumber(-1, 'value', { min: 0 })).toThrow('低于');
    expect(requireFiniteNumber(0.5, 'value', { min: 0, max: 1 })).toBe(0.5);
  });
});
