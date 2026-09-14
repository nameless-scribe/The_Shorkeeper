import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionRequestPayload } from '@/shared/types';
import {
  canRespond,
  initialPermissionQueue,
  permissionQueueReducer,
  type PermissionQueueAction,
  type PermissionQueueState,
} from './permission-queue';

export function usePermissionRequests() {
  const [request, setRequest] = useState<PermissionRequestPayload | null>(null);
  // 队列状态放在 ref 里由 reducer 推进，再把要展示的那条同步给 state。
  // 不用 useReducer / setState updater：IPC 事件可能在同一 tick 内连来两条，
  // 必须能同步读到最新状态；updater 形式还会被 StrictMode 双调用。
  const stateRef = useRef<PermissionQueueState>(initialPermissionQueue);

  const dispatch = useCallback((action: PermissionQueueAction) => {
    const next = permissionQueueReducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setRequest(next.current);
  }, []);

  useEffect(() => {
    if (!window.shorekeeper) return;
    const off = window.shorekeeper.permission.onRequest((payload) => {
      dispatch({ type: 'received', payload });
    });
    return off;
  }, [dispatch]);

  const respond = useCallback(async (approved: boolean) => {
    const current = stateRef.current.current;
    if (!current || !canRespond(stateRef.current)) return;
    const { requestId } = current;
    dispatch({ type: 'respond_started', requestId });
    let delivered = false;
    try {
      await window.shorekeeper.permission.respond(requestId, approved);
      delivered = true;
    } finally {
      // 送达才推进；没送达只解除 in-flight，这条请求留在原位让用户重试。
      dispatch({ type: delivered ? 'respond_settled' : 'respond_failed', requestId });
    }
  }, [dispatch]);

  return { request, respond };
}
