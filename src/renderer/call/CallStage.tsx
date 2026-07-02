import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgUiEvent, CallState } from '@/shared/types';
import { AppBackground } from '../components/AppBackground';
import { AgentAvatar } from '../components/AgentAvatar';
import { PermissionDialog } from '../components/PermissionDialog';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useCallVad } from '../hooks/useCallVad';
import { useCallStreamPlayback } from '../hooks/useCallStreamPlayback';
import { usePermissionRequests } from '../hooks/usePermissionRequests';

const STATE_LABELS: Record<Exclude<CallState, 'idle'>, string> = {
  listening: '聆听中',
  thinking: '思考中',
  speaking: '说话中',
};

const STATE_RING: Record<Exclude<CallState, 'idle'>, string> = {
  listening: 'from-keeper-cyan/70 via-keeper-iceDeep/35 to-keeper-cyan/15',
  thinking: 'from-violet-400/55 via-indigo-400/25 to-violet-300/10',
  speaking: 'from-amber-300/70 via-keeper-cyan/40 to-amber-200/20',
};

export function CallStage() {
  const callIdRef = useRef<string | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const inputStatusRef = useRef<'idle' | 'recording' | 'transcribing'>('idle');
  const streamEndPendingRef = useRef(false);
  const interruptInFlightRef = useRef(false);
  const submittingRef = useRef(false);

  const [callId, setCallId] = useState<string | null>(null);

  const [callState, setCallState] = useState<CallState>('idle');
  const [displayName, setDisplayName] = useState('守岸人');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [callMode, setCallMode] = useState<'push_to_talk' | 'vad_auto'>('vad_auto');
  const [callAllowBargeIn, setCallAllowBargeIn] = useState(true);
  const [callSilenceMs, setCallSilenceMs] = useState(800);

  const { request: permissionRequest, respond: respondPermission } = usePermissionRequests();
  const { status: inputStatus, error: inputError, level, start, stopAndTranscribe, cancel } =
    useVoiceInput();
  const {
    playing: streamPlaying,
    loading: streamLoading,
    error: playbackError,
    reset: resetStreamPlayback,
    startRound,
    enqueue,
    markStreamEnd,
    stop: stopStreamPlayback,
  } = useCallStreamPlayback();

  callStateRef.current = callState;
  inputStatusRef.current = inputStatus;

  const canSpeak =
    !starting &&
    callState === 'listening' &&
    inputStatus === 'idle' &&
    !streamPlaying &&
    !streamLoading &&
    !submittingRef.current;

  const submitUserText = useCallback(async (text: string) => {
    const callId = callIdRef.current;
    if (!callId || !text.trim() || submittingRef.current) return;

    submittingRef.current = true;
    try {
      const result = await window.shorekeeper.voice.call.userText({ callId, text });
      if (!result.ok) {
        setError(result.error);
      }
    } finally {
      submittingRef.current = false;
    }
  }, []);

  const performInterrupt = useCallback(async () => {
    const callId = callIdRef.current;
    if (!callId || interruptInFlightRef.current) return;

    interruptInFlightRef.current = true;
    streamEndPendingRef.current = false;
    stopStreamPlayback();
    resetStreamPlayback();

    try {
      const result = await window.shorekeeper.voice.call.interrupt({ callId });
      if (!result.ok) {
        setError(result.error);
      }
    } finally {
      interruptInFlightRef.current = false;
    }
  }, [resetStreamPlayback, stopStreamPlayback]);

  const handleVadSpeechStart = useCallback(async () => {
    const activeCallId = callIdRef.current;
    if (!activeCallId) return;

    const state = callStateRef.current;
    let allowRecording = false;

    if (callAllowBargeIn && (state === 'speaking' || state === 'thinking')) {
      await performInterrupt();
      allowRecording = true;
    } else if (callMode === 'vad_auto' && state === 'listening') {
      allowRecording = true;
    }

    if (!allowRecording || inputStatusRef.current === 'recording') return;

    setError(null);
    await start(activeCallId);
  }, [callAllowBargeIn, callMode, performInterrupt, start]);

  const handleVadSpeechEnd = useCallback(async () => {
    if (inputStatusRef.current !== 'recording') return;

    const text = await stopAndTranscribe();
    if (!text.trim()) return;
    await submitUserText(text);
  }, [stopAndTranscribe, submitUserText]);

  useCallVad({
    enabled: !starting && Boolean(callId),
    callMode,
    callAllowBargeIn,
    callSilenceMs,
    callState,
    onSpeechStart: handleVadSpeechStart,
    onSpeechEnd: handleVadSpeechEnd,
    onError: (message) => setError(message),
  });

  const endCall = useCallback(async () => {
    const callId = callIdRef.current;
    if (callId) {
      callIdRef.current = null;
      setCallId(null);
      await window.shorekeeper.voice.call.end({ callId }).catch(console.error);
    }
    stopStreamPlayback();
    cancel();
  }, [cancel, stopStreamPlayback]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [session, voiceSettings] = await Promise.all([
          window.shorekeeper.sessions.current(),
          window.shorekeeper.voice.getSettings(),
        ]);
        if (cancelled) return;

        setCallMode(voiceSettings.callMode);
        setCallAllowBargeIn(voiceSettings.callAllowBargeIn);
        setCallSilenceMs(voiceSettings.callSilenceMs);

        const result = await window.shorekeeper.voice.call.start({ sessionId: session.id });
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          setStarting(false);
          return;
        }
        callIdRef.current = result.callId;
        setCallId(result.callId);
        setCallState('listening');
        setStarting(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '无法开始通话');
          setStarting(false);
        }
      }
    })();

    window.shorekeeper.persona.get().then((p) => setDisplayName(p.displayName)).catch(console.error);

    return () => {
      cancelled = true;
      void endCall();
    };
  }, [endCall]);

  useEffect(() => {
    const off = window.shorekeeper.agent.onEvent((raw) => {
      const event = raw as AgUiEvent;
      const callId = callIdRef.current;
      if (!callId) return;

      if (event.type === 'call_state' && event.callId === callId) {
        if (event.state === 'thinking') {
          streamEndPendingRef.current = false;
          resetStreamPlayback();
          void startRound();
        }
        setCallState(event.state);
        return;
      }

      if (event.type === 'call_audio_chunk' && event.callId === callId) {
        enqueue(event.seq, event.audio);
        return;
      }

      if (event.type === 'call_speech_end' && event.callId === callId) {
        if (interruptInFlightRef.current) return;
        streamEndPendingRef.current = true;
        void (async () => {
          const played = await markStreamEnd();
          streamEndPendingRef.current = false;
          if (interruptInFlightRef.current) return;
          const activeCallId = callIdRef.current;
          if (activeCallId && callStateRef.current === 'speaking') {
            await window.shorekeeper.voice.call.speakingDone({ callId: activeCallId });
          }
        })();
        return;
      }

      if (event.type === 'call_error' && event.callId === callId) {
        setError(event.message);
      }
    });

    return () => {
      off();
    };
  }, [enqueue, markStreamEnd, resetStreamPlayback, startRound]);

  const handlePushStart = useCallback(() => {
    if (callMode !== 'push_to_talk' || !canSpeak) return;
    setError(null);
    void start(callIdRef.current ?? undefined);
  }, [callMode, canSpeak, start]);

  const handlePushEnd = useCallback(async () => {
    if (callMode !== 'push_to_talk' || inputStatus !== 'recording') return;
    const text = await stopAndTranscribe();
    if (!text.trim()) return;
    await submitUserText(text);
  }, [callMode, inputStatus, stopAndTranscribe, submitUserText]);

  const handleHangUp = useCallback(async () => {
    await endCall();
    await window.shorekeeper.window.destroyCall();
  }, [endCall]);

  const toggleCallMode = useCallback(async () => {
    const next = callMode === 'push_to_talk' ? 'vad_auto' : 'push_to_talk';
    try {
      const saved = await window.shorekeeper.voice.saveSettings({
        callMode: next,
        callAllowBargeIn: next === 'vad_auto' ? true : callAllowBargeIn,
      });
      setCallMode(saved.callMode);
      setCallAllowBargeIn(saved.callAllowBargeIn);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法切换通话模式');
    }
  }, [callAllowBargeIn, callMode]);

  const visibleState = callState === 'idle' ? 'listening' : callState;
  const stateLabel = starting ? '连接中…' : STATE_LABELS[visibleState];
  const combinedError = error ?? inputError ?? playbackError;
  const isVadAuto = callMode === 'vad_auto';

  return (
    <div className="keeper-panel-shell border border-keeper-silver/25 shadow-cyanSm">
      <AppBackground variant="status" />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <header className="drag-region keeper-glass-panel flex shrink-0 items-center justify-between rounded-t-3xl border-b border-keeper-cyan/15 px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-keeper-ice">{displayName}</h1>
            <p className="text-xs text-keeper-ice/60">语音通话 · {isVadAuto ? '全双工' : '半双工'}</p>
          </div>
          <div className="no-drag flex items-center gap-1">
            <button
              type="button"
              onClick={() => void toggleCallMode()}
              className="rounded-lg border border-keeper-cyan/25 px-2 py-1 text-[10px] text-keeper-cyan/80 transition hover:bg-keeper-cyan/10"
              title={isVadAuto ? '切换为按住说话' : '切换为连续聆听'}
            >
              {isVadAuto ? '全双工' : '半双工'}
            </button>
            <button
              type="button"
              onClick={() => window.shorekeeper.window.minimize()}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
              title="最小化"
            >
              ─
            </button>
            <button
              type="button"
              onClick={() => void handleHangUp()}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-red-500/20 hover:text-red-300"
              title="挂断并关闭"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4 py-5">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div
                className={`absolute -inset-3 rounded-full bg-gradient-to-br ${STATE_RING[visibleState]} opacity-60 blur-md ${callState === 'speaking' ? 'animate-pulse-glow' : ''}`}
              />
              <AgentAvatar size="lg" className="relative !h-28 !w-28" />
            </div>
            <p className="text-base font-medium tracking-wide text-keeper-ice">{stateLabel}</p>
            {(inputStatus === 'recording' || (isVadAuto && callState === 'listening')) && (
              <div className="flex w-44 items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-keeper-ice/10">
                  <div
                    className="h-full rounded-full bg-keeper-cyan transition-all duration-100"
                    style={{
                      width: `${Math.round((inputStatus === 'recording' ? level : 0.15) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-keeper-ice/50">
                  {inputStatus === 'recording' ? '录音中' : '正在聆听…'}
                </span>
              </div>
            )}
          </div>
        </div>

        {combinedError && (
          <div className="mx-4 mb-2 rounded-xl border border-red-400/30 bg-red-950/40 px-3 py-2 text-xs text-red-200 no-drag">
            {combinedError}
          </div>
        )}

        <div className="no-drag flex flex-col items-center gap-3 px-4 pb-5">
          {!isVadAuto && (
            <button
              type="button"
              disabled={!canSpeak && inputStatus !== 'recording'}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                handlePushStart();
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                void handlePushEnd();
              }}
              onPointerCancel={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                cancel();
              }}
              className={`flex h-16 w-16 items-center justify-center rounded-full border-2 text-2xl transition ${
                inputStatus === 'recording'
                  ? 'border-keeper-cyan bg-keeper-cyan/20 text-keeper-cyan shadow-cyanSm'
                  : canSpeak
                    ? 'border-keeper-cyan/40 bg-white/[0.05] text-keeper-ice hover:border-keeper-cyan/70 hover:bg-keeper-cyan/10'
                    : 'cursor-not-allowed border-keeper-ice/15 bg-white/[0.02] text-keeper-ice/30'
              }`}
              title="按住说话"
            >
              🎙
            </button>
          )}

          {isVadAuto && (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-keeper-cyan/50 bg-keeper-cyan/10 text-2xl text-keeper-cyan shadow-cyanSm">
              🎙
            </div>
          )}

          <p className="text-[11px] text-keeper-ice/45">
            {inputStatus === 'transcribing'
              ? '识别中…'
              : callState === 'thinking'
                ? callAllowBargeIn
                  ? '思考中，可直接说话打断'
                  : '守岸人正在思考'
                : callState === 'speaking'
                  ? callAllowBargeIn
                    ? '播放中，说话即可打断'
                    : '播放中，请稍候'
                  : isVadAuto
                    ? '正在聆听，直接说话即可'
                    : '按住说话'}
          </p>

          <button
            type="button"
            onClick={() => void handleHangUp()}
            className="mt-1 rounded-full border border-red-400/35 bg-red-950/30 px-6 py-2 text-sm text-red-200 transition hover:bg-red-900/40"
          >
            挂断
          </button>
        </div>
      </div>

      <PermissionDialog request={permissionRequest} onRespond={respondPermission} />
    </div>
  );
}
