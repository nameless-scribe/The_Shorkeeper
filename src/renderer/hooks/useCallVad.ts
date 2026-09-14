import { useCallback, useEffect, useRef } from 'react';
import type { CallState } from '@/shared/types';
import {
  createVadController,
  VAD_PLAYBACK_GUARD_MS,
  VAD_THRESHOLD_BARGE_IN,
  VAD_THRESHOLD_LISTENING,
  type VadController,
} from '../voice/vad';

export interface UseCallVadOptions {
  enabled: boolean;
  callMode: 'push_to_talk' | 'vad_auto';
  callAllowBargeIn: boolean;
  callSilenceMs: number;
  callState: CallState;
  onSpeechStart: () => void | Promise<void>;
  onSpeechEnd: () => void | Promise<void>;
  /** 说话太短被判为误触发：vad-web 此时不会再发 onSpeechEnd，调用方须自行收尾。 */
  onMisfire?: () => void | Promise<void>;
  onError?: (message: string) => void;
}

/**
 * Manages MicVAD lifecycle for voice calls: continuous listening in vad_auto,
 * and optional barge-in detection during agent thinking/speaking.
 */
export function useCallVad(options: UseCallVadOptions): void {
  const controllerRef = useRef<VadController | null>(null);
  const controllerPromiseRef = useRef<Promise<VadController | null> | null>(null);
  const controllerGenerationRef = useRef(0);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const disposedRef = useRef(false);
  const runningRef = useRef(false);
  const speakingEnteredAtRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const shouldRunVad = useCallback((): boolean => {
    const { enabled, callMode, callAllowBargeIn, callState } = optionsRef.current;
    if (disposedRef.current || !enabled || callState === 'idle') return false;
    if (callMode === 'vad_auto' && callState === 'listening') return true;
    if (callAllowBargeIn && (callState === 'thinking' || callState === 'speaking')) return true;
    return false;
  }, []);

  const getThreshold = useCallback((): number => {
    const { callMode, callAllowBargeIn, callState } = optionsRef.current;
    if (callAllowBargeIn && (callState === 'thinking' || callState === 'speaking')) {
      return VAD_THRESHOLD_BARGE_IN;
    }
    if (callMode === 'vad_auto' && callState === 'listening') {
      return VAD_THRESHOLD_LISTENING;
    }
    return VAD_THRESHOLD_LISTENING;
  }, []);

  const handleSpeechStart = useCallback(async () => {
    const { callAllowBargeIn, callState, onSpeechStart } = optionsRef.current;
    if (
      callAllowBargeIn &&
      callState === 'speaking' &&
      Date.now() - speakingEnteredAtRef.current < VAD_PLAYBACK_GUARD_MS
    ) {
      return;
    }
    await onSpeechStart();
  }, []);

  const handleSpeechEnd = useCallback(async () => {
    await optionsRef.current.onSpeechEnd();
  }, []);

  const handleMisfire = useCallback(async () => {
    await optionsRef.current.onMisfire?.();
  }, []);

  const ensureController = useCallback(async (): Promise<VadController | null> => {
    if (controllerRef.current) return controllerRef.current;
    if (controllerPromiseRef.current) return controllerPromiseRef.current;

    const generation = controllerGenerationRef.current;
    const pending = (async () => {
      try {
        const controller = await createVadController({
          redemptionMs: optionsRef.current.callSilenceMs,
          positiveSpeechThreshold: getThreshold(),
          onSpeechStart: handleSpeechStart,
          onSpeechEnd: handleSpeechEnd,
          onMisfire: handleMisfire,
          onError: (message) => {
            optionsRef.current.onError?.(message);
          },
        });
        if (generation !== controllerGenerationRef.current) {
          await controller.destroy().catch(() => undefined);
          return null;
        }
        controllerRef.current = controller;
        return controller;
      } catch (err) {
        const message = err instanceof Error ? err.message : '语音活动检测不可用';
        optionsRef.current.onError?.(message);
        return null;
      }
    })();
    controllerPromiseRef.current = pending;
    try {
      return await pending;
    } finally {
      if (controllerPromiseRef.current === pending) {
        controllerPromiseRef.current = null;
      }
    }
  }, [getThreshold, handleMisfire, handleSpeechEnd, handleSpeechStart]);

  const syncVad = useCallback(async () => {
    const { callState } = optionsRef.current;
    if (callState === 'speaking') {
      speakingEnteredAtRef.current = Date.now();
    }

    if (!shouldRunVad()) {
      if (runningRef.current && controllerRef.current) {
        await controllerRef.current.pause();
        runningRef.current = false;
      }
      return;
    }

    const controller = await ensureController();
    if (!controller || !shouldRunVad()) return;

    controller.configure(getThreshold(), optionsRef.current.callSilenceMs);
    if (!runningRef.current) {
      await controller.start();
      runningRef.current = true;
    }
  }, [ensureController, getThreshold, shouldRunVad]);

  // 挂载/卸载效果必须写在同步效果之前，且挂载时要把 disposed 复位：
  // React StrictMode 在开发模式下会"挂载 → 模拟卸载 → 再挂载"，ref 跨这两次挂载保留。
  // 此前清理只置 true 不复位，导致第二次挂载后 shouldRunVad 永远为 false，
  // 通话页一直停在"正在聆听"却从不检测说话，且没有任何报错。
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      controllerGenerationRef.current += 1;
      runningRef.current = false;
      void controllerRef.current?.destroy().catch(() => undefined);
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const sync = syncQueueRef.current
      .catch(() => undefined)
      .then(syncVad)
      .catch((error) => {
        optionsRef.current.onError?.(
          error instanceof Error ? error.message : '语音活动检测状态切换失败',
        );
      });
    syncQueueRef.current = sync;
  }, [
    syncVad,
    options.enabled,
    options.callMode,
    options.callAllowBargeIn,
    options.callSilenceMs,
    options.callState,
  ]);

}
