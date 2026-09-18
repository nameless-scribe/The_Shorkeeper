import { describe, expect, it } from 'vitest';
import type { MessageInfo } from '@/shared/types';
import {
  appendStreamPlaceholder,
  appendTextDelta,
  attachToolArtifacts,
  dropStreamingMessages,
  endToolCall,
  finalizeStream,
  findLastPersistedAssistant,
  markThinking,
  startToolCall,
  streamIdForRun,
  stopStream,
  toUiMessages,
  type UiMessage,
} from '../agent-messages';

const STREAM = streamIdForRun('run-1');
const now = Date.parse('2026-09-13T10:00:00Z');

function persisted(overrides: Partial<MessageInfo> = {}): MessageInfo {
  return { id: 'm1', sessionId: 's1', role: 'assistant', content: '你好', createdAt: now, ...overrides };
}

function streaming(overrides: Partial<UiMessage> = {}): UiMessage {
  return { id: STREAM, role: 'assistant', content: '', streaming: true, thinking: true, createdAt: now, ...overrides };
}

const okResult = { success: true, output: '完成' } as never;
const failResult = { success: false, error: '超时' } as never;

describe('agent message transforms', () => {
  it('retains a controlled-stop summary and tool evidence instead of deleting the stream', () => {
    let messages = appendStreamPlaceholder([], STREAM, now);
    messages = startToolCall(messages, STREAM, { callId: 'c1', name: 'read_file', args: {} });
    messages = endToolCall(messages, STREAM, { callId: 'c1', result: { success: true, output: 'ok' } });
    messages = appendTextDelta(messages, STREAM, '本段停止，已读取文件，尚未完成');
    const stopped = stopStream(messages, STREAM, true);
    expect(stopped[0]).toMatchObject({ streaming: false, thinking: false, content: '本段停止，已读取文件，尚未完成' });
    expect(stopped[0].toolCalls).toHaveLength(1);
    expect(stopStream(messages, STREAM, false)).toEqual([]);
    expect(stopStream(stopped, STREAM, true)).toEqual(stopped);
  });
  it('drops system messages and keeps only display fields', () => {
    const list = [
      persisted({ id: 'm0', role: 'system', content: '人设' }),
      persisted({ id: 'm1', role: 'user', content: '在吗' }),
      persisted({ id: 'm2', role: 'assistant', content: '在的' }),
    ];
    expect(toUiMessages(list)).toEqual([
      { id: 'm1', role: 'user', content: '在吗', createdAt: now },
      { id: 'm2', role: 'assistant', content: '在的', createdAt: now },
    ]);
  });

  it('accumulates text deltas and clears the thinking flag', () => {
    let messages = appendStreamPlaceholder([], STREAM, now);
    expect(messages[0]).toMatchObject({ streaming: true, thinking: true, content: '' });
    messages = markThinking(messages, STREAM);
    expect(messages[0].thinking).toBe(true);
    messages = appendTextDelta(messages, STREAM, '守');
    messages = appendTextDelta(messages, STREAM, '岸人');
    expect(messages[0]).toMatchObject({ content: '守岸人', thinking: false, streaming: true });
  });

  it('ignores a repeated tool_call_start for the same callId', () => {
    let messages = appendStreamPlaceholder([], STREAM, now);
    const call = { callId: 'c1', name: 'read_file', args: { path: 'a.md' } };
    messages = startToolCall(messages, STREAM, call);
    const afterFirst = messages;
    messages = startToolCall(messages, STREAM, call);
    expect(messages[0].toolCalls).toHaveLength(1);
    // 重复事件不得产生新的消息对象，否则整条消息会无谓重渲染
    expect(messages[0]).toBe(afterFirst[0]);
  });

  it('marks tool results as done or error and merges related files', () => {
    let messages = appendStreamPlaceholder([], STREAM, now);
    messages = startToolCall(messages, STREAM, { callId: 'c1', name: 'read_file', args: {} });
    messages = startToolCall(messages, STREAM, { callId: 'c2', name: 'write_file', args: {} });
    messages = endToolCall(messages, STREAM, { callId: 'c1', result: okResult });
    messages = endToolCall(messages, STREAM, { callId: 'c2', result: failResult });
    expect(messages[0].toolCalls?.map((tc) => tc.status)).toEqual(['done', 'error']);
  });

  it('keeps a finished message that has tool calls but no text, and drops an empty shell', () => {
    const withTools = startToolCall(appendStreamPlaceholder([], STREAM, now), STREAM, {
      callId: 'c1', name: 'read_file', args: {},
    });
    const keptFinal = finalizeStream(withTools, STREAM, '');
    expect(keptFinal.messages).toHaveLength(1);
    expect(keptFinal.messages[0]).toMatchObject({ streaming: false, thinking: false });
    expect(keptFinal.hasToolCalls).toBe(true);

    const emptyFinal = finalizeStream(appendStreamPlaceholder([], STREAM, now), STREAM, '   ');
    expect(emptyFinal.messages).toHaveLength(0);
    expect(emptyFinal.hasToolCalls).toBe(false);
  });

  it('falls back to the streamed content already on the message when the run reports none', () => {
    // 本轮上报正文为空，但消息上已累积了增量：必须保留用户已经看见的内容，不能整条丢弃。
    const streamed = appendTextDelta(appendStreamPlaceholder([], STREAM, now), STREAM, '已经收到的正文');
    const finalized = finalizeStream(streamed, STREAM, '');
    expect(finalized.messages).toHaveLength(1);
    expect(finalized.messages[0]).toMatchObject({ content: '已经收到的正文', streaming: false });
  });

  it('backfills tool calls onto the last assistant message only', () => {
    const messages = toUiMessages([
      persisted({ id: 'a1', role: 'assistant', content: '上一轮' }),
      persisted({ id: 'u1', role: 'user', content: '再来' }),
      persisted({ id: 'a2', role: 'assistant', content: '这一轮' }),
    ]);
    const toolCalls = [{ callId: 'c1', name: 'read_file', args: {}, status: 'done' as const }];
    const next = attachToolArtifacts(messages, { toolCalls });
    expect(next[2].toolCalls).toEqual(toolCalls);
    expect(next[0].toolCalls).toBeUndefined();
    expect(attachToolArtifacts(messages, {})).toBe(messages);
  });

  it('finds the last assistant message that actually has text', () => {
    const messages = toUiMessages([
      persisted({ id: 'a1', role: 'assistant', content: '有正文' }),
      persisted({ id: 'a2', role: 'assistant', content: '   ' }),
    ]);
    expect(findLastPersistedAssistant(messages)?.id).toBe('a1');
    expect(findLastPersistedAssistant([])).toBeNull();
  });

  it('drops every streaming message on run error but keeps settled ones', () => {
    const messages = [
      { id: 'a1', role: 'assistant' as const, content: '已完成的回复' },
      streaming(),
    ];
    expect(dropStreamingMessages(messages).map((m) => m.id)).toEqual(['a1']);
  });

  // StrictMode 会把 state updater 调用两次。这些变换被当作 updater 体使用，
  // 必须满足：同一份输入调用两次，结果一致，且不修改入参。
  it('stays pure and stable when applied twice with the same input (StrictMode double-invoke)', () => {
    const base = startToolCall(appendStreamPlaceholder([], STREAM, now), STREAM, {
      callId: 'c1', name: 'read_file', args: { path: 'a.md' },
    });
    const snapshot = JSON.stringify(base);

    const cases: Array<() => unknown> = [
      () => appendStreamPlaceholder(base, streamIdForRun('run-2'), now),
      () => markThinking(base, STREAM),
      () => appendTextDelta(base, STREAM, '增量'),
      () => startToolCall(base, STREAM, { callId: 'c2', name: 'write_file', args: {} }),
      () => endToolCall(base, STREAM, { callId: 'c1', result: okResult }),
      () => dropStreamingMessages(base),
      () => finalizeStream(base, STREAM, '正文'),
      () => attachToolArtifacts(base, { toolCalls: [] }),
    ];

    for (const run of cases) {
      expect(JSON.stringify(run())).toEqual(JSON.stringify(run()));
      expect(JSON.stringify(base)).toBe(snapshot);
    }
  });
});
