import { useCallback, useEffect, useRef, useState } from 'react';
import type { SttLanguage } from '@/shared/types';
import { STT_FRAME_BYTES } from '@/voice/types';
import { startPcmRecording, type PcmRecorder } from '../voice/record-pcm';
import { splitPcmFrames, type PcmBytes } from '../voice/pcm-frames';
import { PCM_BYTES_PER_MS, PcmPreRollBuffer, PRE_ROLL_MS } from '../voice/pre-roll-buffer';

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing';

interface UseVoiceInputResult {
  status: VoiceInputStatus;
  error: string | null;
  /** RMS input level 0–1 while recording (for a mic meter). */
  level: number;
  /** Begin capture. Pass callId to use streaming STT during a voice call. */
  start: (callId?: string) => Promise<void>;
  /** Stop capture, transcribe, and return the recognized text ('' if empty). */
  stopAndTranscribe: (lang?: SttLanguage) => Promise<string>;
  /** Abort capture without transcribing. */
  cancel: () => void;
  /**
   * 通话期间让麦克风常开并保留最近一小段音频。之后 start(callId) 不再重新开麦、加载 worklet，
   * 并把这段"前导"连同建流期间排队的音频一起送进识别流——这是为了不丢开口的头几个字。
   */
  arm: () => Promise<void>;
  /** 关掉常开的麦克风。若正在用它录音，先取消这次录音。 */
  disarm: () => void;
  armed: boolean;
}

/** 正在进行的一次录音：owned 表示麦克风由这次录音自己打开、结束时自己关；否则借用常开的麦克风。 */
interface ActiveCapture {
  recorder: PcmRecorder;
  owned: boolean;
}

function toExactBuffer(bytes: PcmBytes): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Push-to-talk microphone input: records 16 kHz PCM, sends it to the main
 * process for Paraformer transcription, and returns the text. Mirrors the
 * generation-guard + unmount-cleanup conventions of useVoicePlayback.
 */
export function useVoiceInput(): UseVoiceInputResult {
  const activeRef = useRef<ActiveCapture | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pcmBufferRef = useRef<PcmBytes>(new Uint8Array(0));
  const pushQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pushFailedRef = useRef(false);
  const generationRef = useRef(0);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 常开麦克风（通话期间）：空闲时音频进前导缓冲，录音时经 liveSink 送出。
  const armedRef = useRef<PcmRecorder | null>(null);
  const armingRef = useRef<Promise<void> | null>(null);
  const armingTokens = useRef<object | null>(null);
  const preRollRef = useRef(new PcmPreRollBuffer(PRE_ROLL_MS * PCM_BYTES_PER_MS));
  const liveSinkRef = useRef<((pcm: ArrayBuffer) => void) | null>(null);

  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [armed, setArmed] = useState(false);

  const clearLevelTimer = useCallback(() => {
    if (levelTimerRef.current !== null) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    setLevel(0);
  }, []);

  const startLevelTimer = useCallback((recorder: PcmRecorder) => {
    clearLevelTimer();
    levelTimerRef.current = setInterval(() => {
      setLevel(recorder.level);
    }, 100);
  }, [clearLevelTimer]);

  const flushPcmBuffer = useCallback(async (callId: string) => {
    const pending = pcmBufferRef.current;
    if (pending.byteLength === 0) return;
    pcmBufferRef.current = new Uint8Array(0);
    const result = await window.shorekeeper.voice.stt.pushChunk({
      callId,
      chunk: pending.slice().buffer,
    });
    if (!result.ok) throw new Error(result.error);
  }, []);

  const pushPcmFrame = useCallback(
    async (callId: string, pcm: ArrayBuffer) => {
      const { frames, remainder } = splitPcmFrames(pcmBufferRef.current, new Uint8Array(pcm), STT_FRAME_BYTES);
      // 先把余数落回缓冲：即使某一帧发送失败抛出，已切出的帧也不会被重复发送。
      pcmBufferRef.current = remainder;
      for (const frame of frames) {
        const result = await window.shorekeeper.voice.stt.pushChunk({
          callId,
          chunk: frame.buffer,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
      }
    },
    [],
  );

  const enqueuePcmFrame = useCallback((callId: string, pcm: ArrayBuffer) => {
    if (pushFailedRef.current) return;
    const generation = generationRef.current;
    const queued = pushQueueRef.current
      .then(async () => {
        if (generation !== generationRef.current || pushFailedRef.current) return;
        await pushPcmFrame(callId, pcm);
      })
      .catch((err) => {
        if (generation !== generationRef.current) return;
        pushFailedRef.current = true;
        setError(err instanceof Error ? err.message : '语音识别流发送失败');
        void window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
      });
    pushQueueRef.current = queued;
  }, [pushPcmFrame]);

  /** 取消当前这次录音对麦克风的使用：自己开的就关掉，借用常开的就只断开送出。 */
  const cancelCapture = useCallback((active: ActiveCapture | null) => {
    liveSinkRef.current = null;
    if (active?.owned) active.recorder.cancel();
  }, []);

  const teardown = useCallback(() => {
    clearLevelTimer();
    activeRef.current = null;
    callIdRef.current = null;
    pcmBufferRef.current = new Uint8Array(0);
  }, [clearLevelTimer]);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    const callId = callIdRef.current;
    cancelCapture(activeRef.current);
    if (callId) {
      void window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
    }
    teardown();
    setStatus('idle');
  }, [cancelCapture, teardown]);

  const disarm = useCallback(() => {
    if (activeRef.current && !activeRef.current.owned) cancel();
    liveSinkRef.current = null;
    armingRef.current = null;
    armingTokens.current = null;
    armedRef.current?.cancel();
    armedRef.current = null;
    preRollRef.current.clear();
    setArmed(false);
  }, [cancel]);

  const arm = useCallback(async () => {
    if (armedRef.current) return;
    if (armingRef.current) return armingRef.current;

    // 用 token 而非 promise 自身做身份比较：promise 在自己的初始化表达式里还不可用。
    const token = {};
    armingTokens.current = token;
    const pending: Promise<void> = (async () => {
      try {
        const recorder = await startPcmRecording({
          retainAudio: false,
          onError: (message) => {
            if (armedRef.current !== recorder) return;
            armedRef.current = null;
            setArmed(false);
            setError(message);
            if (activeRef.current && !activeRef.current.owned) cancel();
          },
          onPcmFrame: (pcm) => {
            const sink = liveSinkRef.current;
            if (sink) sink(pcm);
            else preRollRef.current.push(new Uint8Array(pcm));
          },
        });
        if (armingTokens.current !== token) {
          // 等待期间已 disarm：不留下一个没人管的麦克风。
          recorder.cancel();
          return;
        }
        armedRef.current = recorder;
        setArmed(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法访问麦克风');
      } finally {
        if (armingTokens.current === token) {
          armingTokens.current = null;
          armingRef.current = null;
        }
      }
    })();
    armingRef.current = pending;
    return pending;
  }, [cancel]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      const callId = callIdRef.current;
      if (callId) {
        void window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
      }
      cancelCapture(activeRef.current);
      armingRef.current = null;
      armingTokens.current = null;
      armedRef.current?.cancel();
      armedRef.current = null;
      teardown();
    },
    [cancelCapture, teardown],
  );

  const start = useCallback(async (callId?: string) => {
    if (activeRef.current) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    setError(null);
    pcmBufferRef.current = new Uint8Array(0);
    pushQueueRef.current = Promise.resolve();
    pushFailedRef.current = false;
    callIdRef.current = callId ?? null;

    const fail = (message: string) => {
      if (generation !== generationRef.current) return;
      cancelCapture(activeRef.current);
      teardown();
      setError(message);
      setStatus('idle');
    };

    const armedRecorder = callId ? armedRef.current : null;
    if (callId && armedRecorder) {
      // 麦克风已常开：立刻进入录音态。建流期间的音频先排队，连上后连同前导一起冲刷。
      const queued: ArrayBuffer[] = [];
      const preRoll = preRollRef.current.drain();
      liveSinkRef.current = (pcm) => {
        queued.push(pcm);
      };
      activeRef.current = { recorder: armedRecorder, owned: false };
      setStatus('recording');
      startLevelTimer(armedRecorder);

      let streamResult: Awaited<ReturnType<typeof window.shorekeeper.voice.stt.startCallStream>>;
      try {
        streamResult = await window.shorekeeper.voice.stt.startCallStream({ callId });
      } catch (err) {
        fail(err instanceof Error ? err.message : '语音识别流启动失败');
        return;
      }
      if (generation !== generationRef.current) {
        // 等待期间被取消：cancel() 已断开送出；这里只确保主进程那边不留下半开的流。
        void window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
        return;
      }
      if (!streamResult.ok) {
        fail(streamResult.error);
        return;
      }

      if (preRoll.byteLength > 0) enqueuePcmFrame(callId, toExactBuffer(preRoll));
      for (const pcm of queued) enqueuePcmFrame(callId, pcm);
      queued.length = 0;
      liveSinkRef.current = (pcm) => {
        enqueuePcmFrame(callId, pcm);
      };
      return;
    }

    if (callId) {
      let streamResult: Awaited<ReturnType<typeof window.shorekeeper.voice.stt.startCallStream>>;
      try {
        streamResult = await window.shorekeeper.voice.stt.startCallStream({ callId });
      } catch (err) {
        fail(err instanceof Error ? err.message : '语音识别流启动失败');
        return;
      }
      if (generation !== generationRef.current) return;
      if (!streamResult.ok) {
        fail(streamResult.error);
        return;
      }
    }

    let recorder: PcmRecorder;
    try {
      recorder = await startPcmRecording({
        retainAudio: !callId,
        onError: (message) => {
          if (generation !== generationRef.current) return;
          activeRef.current = null;
          clearLevelTimer();
          setError(message);
          setStatus('idle');
        },
        onPcmFrame: callId
          ? (pcm) => {
              enqueuePcmFrame(callId, pcm);
            }
          : undefined,
      });
    } catch (err) {
      if (generation !== generationRef.current) return;
      if (callId) {
        await window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
      }
      setError(err instanceof Error ? err.message : '无法访问麦克风');
      callIdRef.current = null;
      setStatus('idle');
      return;
    }

    if (generation !== generationRef.current) {
      recorder.cancel();
      if (callId) {
        await window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
      }
      return;
    }

    activeRef.current = { recorder, owned: true };
    setStatus('recording');
    startLevelTimer(recorder);
  }, [cancelCapture, clearLevelTimer, enqueuePcmFrame, startLevelTimer, teardown]);

  const stopAndTranscribe = useCallback(
    async (lang?: SttLanguage): Promise<string> => {
      const active = activeRef.current;
      if (!active) return '';

      const generation = generationRef.current;
      const callId = callIdRef.current;
      clearLevelTimer();
      activeRef.current = null;
      callIdRef.current = null;
      setStatus('transcribing');

      try {
        if (callId) {
          if (active.owned) {
            await active.recorder.stop();
          } else {
            // 借用的常开麦克风不关，只停止送出；之后的音频重新进前导缓冲。
            liveSinkRef.current = null;
          }
          if (generation !== generationRef.current) return '';
          await pushQueueRef.current;
          if (generation !== generationRef.current) return '';
          if (pushFailedRef.current) {
            setStatus('idle');
            return '';
          }
          await flushPcmBuffer(callId);
          const result = await window.shorekeeper.voice.stt.finishCallStream({ callId });
          pcmBufferRef.current = new Uint8Array(0);
          if (generation !== generationRef.current) return '';
          setStatus('idle');
          if (!result.ok) {
            setError(result.error);
            return '';
          }
          return result.text;
        }

        const { pcm, sampleRate } = await active.recorder.stop();
        if (pcm.byteLength === 0) {
          if (generation === generationRef.current) setStatus('idle');
          return '';
        }

        const result = await window.shorekeeper.voice.transcribe({ audio: pcm, sampleRate, lang });
        if (generation !== generationRef.current) return '';
        setStatus('idle');
        if (!result.ok) {
          setError(result.error);
          return '';
        }
        return result.text;
      } catch (err) {
        if (callId) {
          await window.shorekeeper.voice.stt.abortCallStream({ callId }).catch(console.error);
        }
        if (generation === generationRef.current) {
          setError(err instanceof Error ? err.message : '语音识别失败');
          setStatus('idle');
        }
        return '';
      }
    },
    [clearLevelTimer, flushPcmBuffer],
  );

  return { status, error, level, start, stopAndTranscribe, cancel, arm, disarm, armed };
}
