import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgUiEvent, CallState } from '@/shared/types';
import { hasSpeakableDialogue } from '@/voice/text-for-speech';
import { AppBackground } from '../components/AppBackground';
import { AgentAvatar } from '../components/AgentAvatar';
import { PermissionDialog } from '../components/PermissionDialog';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useVoicePlayback } from '../hooks/useVoicePlayback';
import { usePermissionRequests } from '../hooks/usePermissionRequests';

const CALL_PLAYBACK_ID_PREFIX = 'call-assistant';

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
  const assistantPendingRef = useRef<string | null>(null);
  const playbackStartedRef = useRef(false);
  const playbackRoundRef = useRef(0);
  const lastPlayedTextRef = useRef<string | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const [playbackTrigger, setPlaybackTrigger] = useState(0);
  const [callState, setCallState] = useState<CallState>('idle');
  const [displayName, setDisplayName] = useState('守岸人');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  const { request: permissionRequest, respond: respondPermission } = usePermissionRequests();
  const { status: inputStatus, error: inputError, level, start, stopAndTranscribe, cancel } =
    useVoiceInput();
  const { playText, stop: stopSpeech, playingId, loadingId, error: playbackError } =
    useVoicePlayback();

  const canSpeak =
    !starting &&
    callState === 'listening' &&
    inputStatus === 'idle' &&
    !playingId &&
    !loadingId;

  callStateRef.current = callState;

  const endCall = useCallback(async () => {
    const callId = callIdRef.current;
    if (callId) {
      callIdRef.current = null;
      await window.shorekeeper.voice.call.end({ callId }).catch(console.error);
    }
    stopSpeech();
    cancel();
  }, [cancel, stopSpeech]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await window.shorekeeper.sessions.current();
        const result = await window.shorekeeper.voice.call.start({ sessionId: session.id });
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          setStarting(false);
          return;
        }
        callIdRef.current = result.callId;
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
          lastPlayedTextRef.current = null;
        }
        setCallState(event.state);
        return;
      }

      if (event.type === 'call_transcript' && event.callId === callId && event.final) {
        if (event.role === 'assistant') {
          assistantPendingRef.current = event.text;
          if (callStateRef.current === 'speaking') {
            setPlaybackTrigger((v) => v + 1);
          }
        }
        return;
      }

      if (event.type === 'call_error' && event.callId === callId) {
        setError(event.message);
      }
    });

    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (callState !== 'speaking') {
      playbackStartedRef.current = false;
      return;
    }

    const text = assistantPendingRef.current;
    if (!text) {
      return;
    }
    if (!hasSpeakableDialogue(text)) {
      assistantPendingRef.current = null;
      const callId = callIdRef.current;
      if (callId) {
        void window.shorekeeper.voice.call.speakingDone({ callId });
      }
      return;
    }

    if (lastPlayedTextRef.current === text) return;

    lastPlayedTextRef.current = text;
    assistantPendingRef.current = null;
    playbackStartedRef.current = true;
    playbackRoundRef.current += 1;
    void playText(`${CALL_PLAYBACK_ID_PREFIX}-${playbackRoundRef.current}`, text);
  }, [callState, playText, playbackTrigger]);

  // Only end speaking after playback actually started and then finished (avoids racing playText startup).
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const active = Boolean(playingId || loadingId);
    if (
      wasPlayingRef.current &&
      !active &&
      callState === 'speaking' &&
      playbackStartedRef.current
    ) {
      playbackStartedRef.current = false;
      const callId = callIdRef.current;
      if (callId) {
        void window.shorekeeper.voice.call.speakingDone({ callId });
      }
    }
    wasPlayingRef.current = active;
  }, [playingId, loadingId, callState]);

  const handlePushStart = useCallback(() => {
    if (!canSpeak) return;
    setError(null);
    void start();
  }, [canSpeak, start]);

  const handlePushEnd = useCallback(async () => {
    if (inputStatus !== 'recording') return;
    const callId = callIdRef.current;
    if (!callId) return;

    const text = await stopAndTranscribe();
    if (!text.trim()) return;

    const result = await window.shorekeeper.voice.call.userText({ callId, text });
    if (!result.ok) {
      setError(result.error);
    }
  }, [inputStatus, stopAndTranscribe]);

  const handleHangUp = useCallback(async () => {
    await endCall();
    await window.shorekeeper.window.destroyCall();
  }, [endCall]);

  const visibleState = callState === 'idle' ? 'listening' : callState;
  const stateLabel = starting ? '连接中…' : STATE_LABELS[visibleState];
  const combinedError = error ?? inputError ?? playbackError;

  return (
    <div className="keeper-panel-shell border border-keeper-silver/25 shadow-cyanSm">
      <AppBackground variant="status" />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <header className="drag-region keeper-glass-panel flex shrink-0 items-center justify-between rounded-t-3xl border-b border-keeper-cyan/15 px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-keeper-ice">{displayName}</h1>
            <p className="text-xs text-keeper-ice/60">语音通话</p>
          </div>
          <div className="no-drag flex gap-1">
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
            {inputStatus === 'recording' && (
              <div className="flex w-44 items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-keeper-ice/10">
                  <div
                    className="h-full rounded-full bg-keeper-cyan transition-all duration-100"
                    style={{ width: `${Math.round(level * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-keeper-ice/50">录音中</span>
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
          <p className="text-[11px] text-keeper-ice/45">
            {inputStatus === 'transcribing'
              ? '识别中…'
              : callState === 'thinking'
                ? '守岸人正在思考'
                : callState === 'speaking'
                  ? '播放中，请稍候'
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
