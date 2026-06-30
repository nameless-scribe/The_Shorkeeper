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

  const respond = useCallback(async (approved: boolean) => {
    const current = requestRef.current;
    if (!current) return;
    await window.shorekeeper.permission.respond(current.requestId, approved);
    setRequest(queueRef.current.shift() ?? null);
  }, []);

  return { request, respond };
}
