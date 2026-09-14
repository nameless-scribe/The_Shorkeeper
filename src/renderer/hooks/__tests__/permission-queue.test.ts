import { describe, expect, it } from 'vitest';
import type { PermissionRequestPayload } from '@/shared/types';
import {
  canRespond,
  initialPermissionQueue,
  permissionQueueReducer,
  type PermissionQueueAction,
  type PermissionQueueState,
} from '../permission-queue';

function payload(requestId: string): PermissionRequestPayload {
  return { requestId, toolName: 'write_file', args: { path: `${requestId}.md` } } as PermissionRequestPayload;
}

function reduce(state: PermissionQueueState, ...actions: PermissionQueueAction[]): PermissionQueueState {
  return actions.reduce(permissionQueueReducer, state);
}

describe('permission queue reducer', () => {
  it('shows the first request and queues the rest', () => {
    const state = reduce(
      initialPermissionQueue,
      { type: 'received', payload: payload('a') },
      { type: 'received', payload: payload('b') },
      { type: 'received', payload: payload('c') },
    );
    expect(state.current?.requestId).toBe('a');
    expect(state.queue.map((item) => item.requestId)).toEqual(['b', 'c']);
  });

  it('advances to the next queued request once the answer is delivered', () => {
    let state = reduce(
      initialPermissionQueue,
      { type: 'received', payload: payload('a') },
      { type: 'received', payload: payload('b') },
      { type: 'respond_started', requestId: 'a' },
    );
    expect(state.inFlight).toBe('a');
    state = permissionQueueReducer(state, { type: 'respond_settled', requestId: 'a' });
    expect(state).toEqual({ current: payload('b'), queue: [], inFlight: null });
  });

  it('blocks a second answer for the request already in flight', () => {
    const state = reduce(
      initialPermissionQueue,
      { type: 'received', payload: payload('a') },
      { type: 'respond_started', requestId: 'a' },
    );
    expect(canRespond(state)).toBe(false);
    // 连按 Enter：第二次 dispatch 不改变状态，也就不会把排队中的下一条顶掉
    expect(permissionQueueReducer(state, { type: 'respond_started', requestId: 'a' })).toBe(state);
  });

  it('keeps the request in place when the answer never reaches the main process', () => {
    let state = reduce(
      initialPermissionQueue,
      { type: 'received', payload: payload('a') },
      { type: 'received', payload: payload('b') },
      { type: 'respond_started', requestId: 'a' },
      { type: 'respond_failed', requestId: 'a' },
    );
    expect(state.current?.requestId).toBe('a');
    expect(state.inFlight).toBeNull();
    expect(canRespond(state)).toBe(true);
    // 重试成功后才推进
    state = reduce(state, { type: 'respond_started', requestId: 'a' }, { type: 'respond_settled', requestId: 'a' });
    expect(state.current?.requestId).toBe('b');
  });

  it('ignores answers for a request that is no longer current', () => {
    const state = reduce(initialPermissionQueue, { type: 'received', payload: payload('a') });
    expect(permissionQueueReducer(state, { type: 'respond_settled', requestId: 'stale' })).toBe(state);
    expect(permissionQueueReducer(state, { type: 'respond_started', requestId: 'stale' })).toBe(state);
  });

  it('does not enqueue the same requestId twice when the event is re-delivered', () => {
    const state = reduce(
      initialPermissionQueue,
      { type: 'received', payload: payload('a') },
      { type: 'received', payload: payload('b') },
      { type: 'received', payload: payload('b') },
      { type: 'received', payload: payload('a') },
    );
    expect(state.current?.requestId).toBe('a');
    expect(state.queue.map((item) => item.requestId)).toEqual(['b']);
  });

  // 这是原先那个 bug 的回归用例：StrictMode 会用同一份 state 与 action 调两次 reducer。
  // 出队若带副作用（原实现在 updater 里 shift），第二条请求会被直接吞掉。
  it('is unaffected by StrictMode double invocation', () => {
    const base = reduce(
      initialPermissionQueue,
      { type: 'received', payload: payload('a') },
      { type: 'received', payload: payload('b') },
      { type: 'received', payload: payload('c') },
    );

    const actions: PermissionQueueAction[] = [
      { type: 'received', payload: payload('d') },
      { type: 'respond_started', requestId: 'a' },
      { type: 'respond_settled', requestId: 'a' },
      { type: 'respond_failed', requestId: 'a' },
    ];

    for (const action of actions) {
      const once = permissionQueueReducer(base, action);
      const twice = permissionQueueReducer(base, action);
      expect(twice).toEqual(once);
      // 入参不得被改写
      expect(base.queue.map((item) => item.requestId)).toEqual(['b', 'c']);
      expect(base.current?.requestId).toBe('a');
    }

    // 回答一条之后，排队中的第二条必须真的出现，而不是被跳过
    const afterFirst = permissionQueueReducer(base, { type: 'respond_settled', requestId: 'a' });
    expect(afterFirst.current?.requestId).toBe('b');
    expect(afterFirst.queue.map((item) => item.requestId)).toEqual(['c']);
  });
});
