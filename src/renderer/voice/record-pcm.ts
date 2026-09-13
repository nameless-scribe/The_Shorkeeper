/**
 * Microphone capture producing raw 16 kHz / 16-bit LE / mono PCM — the exact
 * format Paraformer expects. We ask the browser for a 16 kHz AudioContext so
 * resampling happens in native code, then convert Float32 frames to Int16.
 */

const TARGET_SAMPLE_RATE = 16000;
export const MAX_BUFFERED_PCM_SAMPLES = TARGET_SAMPLE_RATE * 5 * 60;

/** Inline AudioWorklet: forwards every input frame to the main thread untouched. */
const WORKLET_SOURCE = `
class PcmCollector extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      // Copy: the underlying buffer is reused by the engine after process().
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor('pcm-collector', PcmCollector);
`;

export interface PcmRecordingOptions {
  /** Called with Int16 PCM for each captured frame (after Float32→Int16). */
  onPcmFrame?: (pcm: ArrayBuffer) => void;
  /** Streaming STT does not need to retain a second in-memory copy. */
  retainAudio?: boolean;
  onError?: (message: string) => void;
}

export interface PcmRecorder {
  /** Stop capture and return the collected PCM. Safe to call once. */
  stop(): Promise<{ pcm: ArrayBuffer; sampleRate: number }>;
  /** Abort capture and discard audio (e.g. user cancelled). */
  cancel(): void;
  /** Latest input level, 0–1 (RMS of the most recent frame). */
  readonly level: number;
}

/** Map raw getUserMedia / AudioContext failures to friendly Chinese messages. */
function describeCaptureError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return '麦克风权限被拒绝，请在系统设置中允许应用使用麦克风';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return '未检测到麦克风设备';
    }
    if (err.name === 'NotReadableError') {
      return '麦克风被其他程序占用，请关闭后重试';
    }
  }
  return err instanceof Error ? err.message : '无法访问麦克风';
}

function mergeFrames(frames: Float32Array[], totalSamples: number): Float32Array {
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const frame of frames) {
    merged.set(frame, offset);
    offset += frame.length;
  }
  return merged;
}

/** Convert Float32 [-1,1] samples to little-endian Int16 PCM. */
function floatToInt16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out.buffer;
}

/**
 * Begin microphone capture. Resolves once the pipeline is live; reject means
 * nothing was started (permission denied, no device, etc.).
 */
export async function startPcmRecording(options: PcmRecordingOptions = {}): Promise<PcmRecorder> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    throw new Error(describeCaptureError(err));
  }

  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(describeCaptureError(err));
  }

  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, 'pcm-collector');

  const frames: Float32Array[] = [];
  let totalSamples = 0;
  let level = 0;
  let done = false;

  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (done) return;
    const frame = event.data;
    if (options.retainAudio !== false) {
      if (totalSamples + frame.length > MAX_BUFFERED_PCM_SAMPLES) {
        done = true;
        teardown();
        options.onError?.('单次录音超过 5 分钟，已自动停止');
        return;
      }
      frames.push(frame);
      totalSamples += frame.length;
    }

    let sumSquares = 0;
    for (let i = 0; i < frame.length; i += 1) sumSquares += frame[i] * frame[i];
    level = Math.sqrt(sumSquares / frame.length);

    options.onPcmFrame?.(floatToInt16(frame));
  };

  source.connect(worklet);
  // Route to destination so the graph keeps pulling; gain 0 avoids echo.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  worklet.connect(sink);
  sink.connect(ctx.destination);

  const teardown = () => {
    worklet.port.onmessage = null;
    try {
      source.disconnect();
      worklet.disconnect();
      sink.disconnect();
    } catch {
      // already disconnected
    }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };

  return {
    get level() {
      return level;
    },
    async stop() {
      if (done) return { pcm: new ArrayBuffer(0), sampleRate: TARGET_SAMPLE_RATE };
      done = true;
      const sampleRate = ctx.sampleRate;
      const merged = mergeFrames(frames, totalSamples);
      teardown();
      return { pcm: floatToInt16(merged), sampleRate };
    },
    cancel() {
      if (done) return;
      done = true;
      teardown();
    },
  };
}
