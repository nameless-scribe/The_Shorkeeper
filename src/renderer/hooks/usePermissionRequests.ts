import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionRequestPayload } from '@/shared/types';

export function usePermissionRequests() {
  const [request, setRequest] = useState<PermissionRequestPayload | null>(null);
  const queueRef = useRef<PermissionRequestPayload[]>([]);
  const requestRef = useRef<PermissionRequestPayload | null>(null);
  requestRef.current = request;

  useEffect(() => {
    if (!window.shorekeeper) return;
    const off = window.shorekeeper.permission.onRequest((payload) => {
      setRequest((current) => {
        if (!current) return payload;
        queueRef.current.push(payload);
        return current;
      });
    });
    return off;
  }, []);

  const inFlightRef = useRef<string | null>(null);

  const respond = useCallback(async (approved: boolean) => {
    const current = requestRef.current;
    if (!current) return;
    // 同一请求只回答一次：连按 Enter 不能把排队中的下一条请求顶掉。
    if (inFlightRef.current === current.requestId) return;
    inFlightRef.current = current.requestId;
    try {
      await window.shorekeeper.permission.respond(current.requestId, approved);
    } finally {
      inFlightRef.current = null;
    }
    setRequest((active) => (active?.requestId === current.requestId ? queueRef.current.shift() ?? null : active));
  }, []);

  return { request, respond };
}
