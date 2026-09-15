import { describe, expect, it } from 'vitest';
import type { PermissionRequestPayload, UserQuestionRequestPayload } from '@/shared/types';
import {
  canRespond,
  initialPromptQueue,
  promptQueueReducer,
  type PromptQueueAction,
  type PromptQueueState,
  type PromptRequest,
} from '../prompt-queue';

function permission(requestId: string): PromptRequest {
  return {
    kind: 'permission',
    payload: { requestId, toolName: 'write_file', args: { path: `${requestId}.md` } } as PermissionRequestPayload,
  };
}

function question(requestId: string): PromptRequest {
  const payload: UserQuestionRequestPayload = {
    requestId,
    question: `问题 ${requestId}`,
    options: [],
    allowFreeText: true,
  };
  return { kind: 'question', payload };
}

function reduce(state: PromptQueueState, ...actions: PromptQueueAction[]): PromptQueueState {
  return actions.reduce(promptQueueReducer, state);
}

describe('prompt queue reducer', () => {
  it('shows the first request and queues the rest', () => {
    const state = reduce(
      initialPromptQueue,
      { type: 'received', request: permission('a') },
      { type: 'received', request: permission('b') },
      { type: 'received', request: permission('c') },
    );
    expect(state.current?.payload.requestId).toBe('a');
    expect(state.queue.map((item) => item.payload.requestId)).toEqual(['b', 'c']);
  });

  it('keeps permission requests and questions in one line so only one dialog shows at a time', () => {
    let state = reduce(
      initialPromptQueue,
      { type: 'received', request: question('q1') },
      { type: 'received', request: permission('p1') },
      { type: 'received', request: question('q2') },
    );
    expect(state.current).toEqual(question('q1'));
    expect(state.queue.map((item) => `${item.kind}:${item.payload.requestId}`)).toEqual(['permission:p1', 'question:q2']);
    state = reduce(state, { type: 'respond_started', requestId: 'q1' }, { type: 'respond_settled', requestId: 'q1' });
    expect(state.current).toEqual(permission('p1'));
    state = reduce(state, { type: 'respond_started', requestId: 'p1' }, { type: 'respond_settled', requestId: 'p1' });
    expect(state.current).toEqual(question('q2'));
    expect(state.queue).toEqual([]);
  });

  it('advances to the next queued request once the answer is delivered', () => {
    let state = reduce(
      initialPromptQueue,
      { type: 'received', request: permission('a') },
      { type: 'received', request: permission('b') },
      { type: 'respond_started', requestId: 'a' },
    );
    expect(state.inFlight).toBe('a');
    state = promptQueueReducer(state, { type: 'respond_settled', requestId: 'a' });
    expect(state).toEqual({ current: permission('b'), queue: [], inFlight: null });
  });

  it('blocks a second answer for the request already in flight', () => {
    const state = reduce(
      initialPromptQueue,
      { type: 'received', request: permission('a') },
      { type: 'respond_started', requestId: 'a' },
    );
    expect(canRespond(state)).toBe(false);
    // 连按 Enter：第二次 dispatch 不改变状态，也就不会把排队中的下一条顶掉
    expect(promptQueueReducer(state, { type: 'respond_started', requestId: 'a' })).toBe(state);
  });

  it('keeps the request in place when the answer never reaches the main process', () => {
    let state = reduce(
      initialPromptQueue,
      { type: 'received', request: permission('a') },
      { type: 'received', request: permission('b') },
      { type: 'respond_started', requestId: 'a' },
      { type: 'respond_failed', requestId: 'a' },
    );
    expect(state.current?.payload.requestId).toBe('a');
    expect(state.inFlight).toBeNull();
    expect(canRespond(state)).toBe(true);
    // 重试成功后才推进
    state = reduce(state, { type: 'respond_started', requestId: 'a' }, { type: 'respond_settled', requestId: 'a' });
    expect(state.current?.payload.requestId).toBe('b');
  });

  it('ignores answers for a request that is no longer current', () => {
    const state = reduce(initialPromptQueue, { type: 'received', request: permission('a') });
    expect(promptQueueReducer(state, { type: 'respond_settled', requestId: 'stale' })).toBe(state);
    expect(promptQueueReducer(state, { type: 'respond_started', requestId: 'stale' })).toBe(state);
  });

  it('does not enqueue the same requestId twice when the event is re-delivered', () => {
    const state = reduce(
      initialPromptQueue,
      { type: 'received', request: permission('a') },
      { type: 'received', request: question('b') },
      { type: 'received', request: question('b') },
      { type: 'received', request: permission('a') },
    );
    expect(state.current?.payload.requestId).toBe('a');
    expect(state.queue.map((item) => item.payload.requestId)).toEqual(['b']);
  });

  // 这是原先那个 bug 的回归用例：StrictMode 会用同一份 state 与 action 调两次 reducer。
  // 出队若带副作用（原实现在 updater 里 shift），第二条请求会被直接吞掉。
  it('is unaffected by StrictMode double invocation', () => {
    const base = reduce(
      initialPromptQueue,
      { type: 'received', request: permission('a') },
      { type: 'received', request: question('b') },
      { type: 'received', request: permission('c') },
    );

    const actions: PromptQueueAction[] = [
      { type: 'received', request: question('d') },
      { type: 'respond_started', requestId: 'a' },
      { type: 'respond_settled', requestId: 'a' },
      { type: 'respond_failed', requestId: 'a' },
    ];

    for (const action of actions) {
      const once = promptQueueReducer(base, action);
      const twice = promptQueueReducer(base, action);
      expect(twice).toEqual(once);
      // 入参不得被改写
      expect(base.queue.map((item) => item.payload.requestId)).toEqual(['b', 'c']);
      expect(base.current?.payload.requestId).toBe('a');
    }

    // 回答一条之后，排队中的第二条必须真的出现，而不是被跳过
    const afterFirst = promptQueueReducer(base, { type: 'respond_settled', requestId: 'a' });
    expect(afterFirst.current?.payload.requestId).toBe('b');
    expect(afterFirst.queue.map((item) => item.payload.requestId)).toEqual(['c']);
  });
});
