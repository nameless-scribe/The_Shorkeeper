import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgUiEvent, CallState } from '@/shared/types';
import { DAILY_TOKEN_BUDGET } from '@/shared/token-budget';
import { AppBackground } from '../components/AppBackground';
import { AgentAvatar } from '../components/AgentAvatar';
import { PermissionDialog } from '../components/PermissionDialog';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useCallVad } from '../hooks/useCallVad';
import { useCallStreamPlayback } from '../hooks/useCallStreamPlayback';
import { useCallTokenUsage } from '../hooks/useCallTokenUsage';
import { usePermissionRequests } from '../hooks/usePermissionRequests';
import { useWindowDrag } from '../hooks/useWindowDrag';
import {
  applyTranscriptEvent,
  CallTranscriptPanel,
  type TranscriptLine,
} from './CallTranscriptPanel';

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
  const lastFailedTextRef = useRef<string | null>(null);

  const [callId, setCallId] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);

  const [callState, setCallState] = useState<CallState>('idle');
  const [displayName, setDisplayName] = useState('守岸人');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [callMode, setCallMode] = useState<'push_to_talk' | 'vad_auto'>('vad_auto');
  const [callAllowBargeIn, setCallAllowBargeIn] = useState(true);
  const [callSilenceMs, setCallSilenceMs] = useState(800);
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);

  const { request: permissionRequest, respond: respondPermission } = usePermissionRequests();
  const { today, progress, overBudget } = useCallTokenUsage();
  const {
    status: inputStatus,
    error: inputError,
    level,
    start,
    stopAndTranscribe,
    cancel,
    arm: armMicrophone,
    disarm: disarmMicrophone,
  } = useVoiceInput();
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
    const activeCallId = callIdRef.current;
    if (!activeCallId || !text.trim() || submittingRef.current) return;

    submittingRef.current = true;
    lastFailedTextRef.current = text;
    setError(null);
    try {
      const result = await window.shorekeeper.voice.call.userText({ callId: activeCallId, text });
      if (!result.ok) {
        setError(result.error);
        setRetryText(text);
      } else {
        lastFailedTextRef.current = null;
        setRetryText(null);
      }
    } finally {
      submittingRef.current = false;
    }
  }, []);

  const performInterrupt = useCallback(async () => {
    const activeCallId = callIdRef.current;
    if (!activeCallId || interruptInFlightRef.current) return;

    interruptInFlightRef.current = true;
    streamEndPendingRef.current = false;
    stopStreamPlayback();
    resetStreamPlayback();

    try {
      const result = await window.shorekeeper.voice.call.interrupt({ callId: activeCallId });
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

  // 误触发（一声咳嗽、短促噪音）：VAD 不会再发 speech end，
  // 不收尾的话录音与流式识别会一直挂着，界面卡在"录音中"。
  const handleVadMisfire = useCallback(() => {
    if (inputStatusRef.current !== 'recording') return;
    cancel();
  }, [cancel]);

  useCallVad({
    enabled: !starting && Boolean(callId),
    callMode,
    callAllowBargeIn,
    callSilenceMs,
    callState,
    onSpeechStart: handleVadSpeechStart,
    onSpeechEnd: handleVadSpeechEnd,
    onMisfire: handleVadMisfire,
    onError: (message) => setError(message),
  });

  // 通话一建立就让麦克风常开：VAD 触发时不必再开麦、建流，开口前的几百毫秒也能补回来。
  // 通话结束（挂断、窗口关闭）时关掉，麦克风占用指示随之消失。
  useEffect(() => {
    if (starting || !callId) return;
    void armMicrophone();
  }, [armMicrophone, callId, starting]);

  const endCall = useCallback(async () => {
    const activeCallId = callIdRef.current;
    if (activeCallId) {
      callIdRef.current = null;
      setCallId(null);
      await window.shorekeeper.voice.call.end({ callId: activeCallId }).catch(console.error);
    }
    stopStreamPlayback();
    cancel();
    disarmMicrophone();
  }, [cancel, disarmMicrophone, stopStreamPlayback]);

  const endCallRef = useRef(endCall);
  endCallRef.current = endCall;

  const handleHangUp = useCallback(async () => {
    await endCall();
    await window.shorekeeper.window.destroyCall();
  }, [endCall]);

  const degradeToHalfDuplex = useCallback(async () => {
    try {
      const saved = await window.shorekeeper.voice.saveSettings({
        callMode: 'push_to_talk',
        callAllowBargeIn: false,
      });
      setCallMode(saved.callMode);
      setCallAllowBargeIn(saved.callAllowBargeIn);
      setNotice('已切换为半双工模式，请按住说话');
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法切换半双工');
    }
  }, []);

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
      void endCallRef.current();
    };
    // Mount-only: avoid re-running start/end when hook callbacks change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const off = window.shorekeeper.agent.onEvent((raw) => {
      const event = raw as AgUiEvent;
      const activeCallId = callIdRef.current;
      if (!activeCallId) return;

      if (event.type === 'call_state' && event.callId === activeCallId) {
        if (event.state === 'thinking') {
          streamEndPendingRef.current = false;
          resetStreamPlayback();
          void startRound();
        }
        setCallState(event.state);
        return;
      }

      if (event.type === 'call_transcript' && event.callId === activeCallId) {
        setTranscriptLines((prev) =>
          applyTranscriptEvent(prev, event.role, event.text, event.final),
        );
        return;
      }

      if (event.type === 'call_audio_chunk' && event.callId === activeCallId) {
        enqueue(event.seq, event.audio);
        return;
      }

      if (event.type === 'call_speech_end' && event.callId === activeCallId) {
        if (interruptInFlightRef.current) return;
        streamEndPendingRef.current = true;
        void (async () => {
          await markStreamEnd();
          streamEndPendingRef.current = false;
          if (interruptInFlightRef.current) return;
          const currentCallId = callIdRef.current;
          if (currentCallId && callStateRef.current === 'speaking') {
            await window.shorekeeper.voice.call.speakingDone({ callId: currentCallId });
          }
        })();
        return;
      }

      if (event.type === 'call_degraded' && event.callId === activeCallId) {
        setNotice(event.message);
        void degradeToHalfDuplex();
        return;
      }

      if (event.type === 'call_error' && event.callId === activeCallId) {
        setError(event.message);
      }
    });

    return () => {
      off();
    };
  }, [degradeToHalfDuplex, enqueue, markStreamEnd, resetStreamPlayback, startRound]);

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

  const handleRetry = useCallback(() => {
    if (!retryText) {
      setError(null);
      return;
    }
    void submitUserText(retryText);
  }, [retryText, submitUserText]);

  const toggleCallMode = useCallback(async () => {
    const next = callMode === 'push_to_talk' ? 'vad_auto' : 'push_to_talk';
    try {
      const saved = await window.shorekeeper.voice.saveSettings({
        callMode: next,
        callAllowBargeIn: next === 'vad_auto' ? true : callAllowBargeIn,
      });
      setCallMode(saved.callMode);
      setCallAllowBargeIn(saved.callAllowBargeIn);
      setNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法切换通话模式');
    }
  }, [callAllowBargeIn, callMode]);

  const visibleState = callState === 'idle' ? 'listening' : callState;
  const stateLabel = starting ? '连接中…' : STATE_LABELS[visibleState];
  const combinedError = error ?? inputError ?? playbackError;
  const isVadAuto = callMode === 'vad_auto';
  const canRetry = Boolean(retryText && combinedError);
  const drag = useWindowDrag();

  return (
    <div className="keeper-panel-shell border border-keeper-silver/25 shadow-cyanSm">
      <AppBackground variant="chat" />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <header
          className="keeper-glass-panel flex shrink-0 flex-col gap-2 rounded-t-3xl border-b border-keeper-cyan/15 px-4 py-3"
          {...drag}
        >
          <div className="flex items-center justify-between">
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
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-400/40 bg-red-950/40 text-red-300 hover:bg-red-900/50"
                title="挂断并关闭"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="no-drag flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-keeper-navyDeep/80">
              <div
                className={`h-full rounded-full transition-all ${
                  overBudget
                    ? 'bg-gradient-to-r from-red-700 to-red-400'
                    : 'bg-gradient-to-r from-keeper-navy to-keeper-cyan'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className={`shrink-0 text-[10px] ${overBudget ? 'text-red-300' : 'text-keeper-cyan/80'}`}>
              {today.toLocaleString()} / {DAILY_TOKEN_BUDGET.toLocaleString()} 参考
            </span>
          </div>
        </header>

        <CallTranscriptPanel lines={transcriptLines} />

        <div className="flex shrink-0 flex-col items-center gap-3 px-4 py-4">
          <div className="relative">
            <div
              className={`absolute -inset-3 rounded-full bg-gradient-to-br ${STATE_RING[visibleState]} opacity-60 ${callState === 'speaking' ? 'animate-pulse-glow' : ''}`}
            />
            <AgentAvatar size="md" className="relative !h-20 !w-20" />
          </div>
          <p className="text-sm font-medium tracking-wide text-keeper-ice">{stateLabel}</p>
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

        {notice && !combinedError && (
          <div className="mx-4 mb-2 rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-100 no-drag">
            {notice}
          </div>
        )}

        {combinedError && (
          <div className="mx-4 mb-2 rounded-xl border border-red-400/30 bg-red-950/40 px-3 py-2 text-xs text-red-200 no-drag">
            <p>{combinedError}</p>
            <div className="mt-2 flex gap-2">
              {canRetry && (
                <button
                  type="button"
                  onClick={() => void handleRetry()}
                  className="rounded-lg border border-red-300/40 px-2 py-0.5 text-[11px] hover:bg-red-900/40"
                >
                  重试上一条
                </button>
              )}
              <button
                type="button"
                onClick={() => setError(null)}
                className="rounded-lg border border-red-300/25 px-2 py-0.5 text-[11px] hover:bg-red-900/30"
              >
                关闭
              </button>
            </div>
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
            className="mt-1 rounded-full border-2 border-red-400/50 bg-red-950/40 px-8 py-2.5 text-sm font-medium text-red-200 transition hover:bg-red-900/50"
          >
            挂断通话
          </button>
        </div>
      </div>

      <PermissionDialog request={permissionRequest} onRespond={respondPermission} />
    </div>
  );
}
