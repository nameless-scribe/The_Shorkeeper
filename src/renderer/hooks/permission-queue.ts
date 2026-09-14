/**
 * 权限请求队列的纯状态机。不碰 React、IPC 与 window。
 *
 * 抽出来的原因：这套语义（同一时间只展示一条、其余排队、同一条只回答一次、
 * 回答失败不推进队列）原先散在 hook 的 ref 操作里，只能靠真人点弹窗验证，
 * 而它恰好出过一个 StrictMode 下丢请求的 bug —— 丢掉的请求永远得不到回答，
 * Agent 会一直卡在那个决策上。
 *
 * 约束：reducer 必须是纯的。React StrictMode 会用同一份 state 与 action 调用 reducer 两次，
 * 只要没有副作用，双调用就与单调用等价。
 */
import type { PermissionRequestPayload } from '@/shared/types';

export interface PermissionQueueState {
  /** 当前展示给用户的请求 */
  current: PermissionRequestPayload | null;
  /** 等待展示的请求，先进先出 */
  queue: PermissionRequestPayload[];
  /** 正在等待回答送达的请求 id；用于挡住连点 */
  inFlight: string | null;
}

export type PermissionQueueAction =
  | { type: 'received'; payload: PermissionRequestPayload }
  | { type: 'respond_started'; requestId: string }
  /** 回答已送达：推进到下一条 */
  | { type: 'respond_settled'; requestId: string }
  /** 回答没送达：解除 in-flight 让用户重试，但不推进队列 */
  | { type: 'respond_failed'; requestId: string };

export const initialPermissionQueue: PermissionQueueState = {
  current: null,
  queue: [],
  inFlight: null,
};

export function permissionQueueReducer(
  state: PermissionQueueState,
  action: PermissionQueueAction,
): PermissionQueueState {
  switch (action.type) {
    case 'received': {
      // 同一条请求重复送达（IPC 重发）时不重复入队，否则用户会看到已失效的副本。
      if (state.current?.requestId === action.payload.requestId) return state;
      if (state.queue.some((item) => item.requestId === action.payload.requestId)) return state;
      if (!state.current) return { ...state, current: action.payload };
      return { ...state, queue: [...state.queue, action.payload] };
    }
    case 'respond_started': {
      if (state.current?.requestId !== action.requestId) return state;
      if (state.inFlight === action.requestId) return state;
      return { ...state, inFlight: action.requestId };
    }
    case 'respond_settled': {
      if (state.current?.requestId !== action.requestId) return state;
      const [next, ...rest] = state.queue;
      return { current: next ?? null, queue: rest, inFlight: null };
    }
    case 'respond_failed': {
      if (state.inFlight !== action.requestId) return state;
      return { ...state, inFlight: null };
    }
    default:
      return state;
  }
}

/** 回答前的同步判定：没有可答的请求，或这一条已经在途，就直接忽略。 */
export function canRespond(state: PermissionQueueState): boolean {
  return state.current != null && state.inFlight !== state.current.requestId;
}
