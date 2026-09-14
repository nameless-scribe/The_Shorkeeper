import { MicVAD } from '@ricky0123/vad-web';

/** Default VAD sensitivity while listening for user speech. */
export const VAD_THRESHOLD_LISTENING = 0.35;

/** Raised threshold during agent playback to reduce echo false triggers. */
export const VAD_THRESHOLD_BARGE_IN = 0.6;

/** Ignore speech-start events briefly after agent playback begins. */
export const VAD_PLAYBACK_GUARD_MS = 300;

/** VAD + ONNX assets copied to `public/vad/` (dev) and `dist/vad/` (build). */
const VAD_ASSET_DIR = 'vad/';

function resolveVadAssetBase(): string {
  return new URL(VAD_ASSET_DIR, window.location.href).href;
}

export interface VadControllerOptions {
  redemptionMs: number;
  positiveSpeechThreshold?: number;
  onSpeechStart: () => void | Promise<void>;
  onSpeechEnd: () => void | Promise<void>;
  /** vad-web 判定说话过短（misfire）时触发，此时不会再有 onSpeechEnd。 */
  onMisfire?: () => void | Promise<void>;
  onError?: (message: string) => void;
}

export interface VadController {
  start(): Promise<void>;
  pause(): Promise<void>;
  /** Update frame-processor options while running. */
  configure(threshold: number, redemptionMs: number): void;
  destroy(): Promise<void>;
}

export async function createVadController(options: VadControllerOptions): Promise<VadController> {
  const assetBase = resolveVadAssetBase();
  let micVad: MicVAD | null = null;

  try {
    const runCallback = (callback: () => void | Promise<void>) => {
      try {
        void Promise.resolve(callback()).catch((error) => {
          options.onError?.(error instanceof Error ? error.message : String(error));
        });
      } catch (error) {
        options.onError?.(error instanceof Error ? error.message : String(error));
      }
    };
    micVad = await MicVAD.new({
      baseAssetPath: assetBase,
      onnxWASMBasePath: assetBase,
      redemptionMs: options.redemptionMs,
      positiveSpeechThreshold: options.positiveSpeechThreshold ?? VAD_THRESHOLD_LISTENING,
      ortConfig: (ort) => {
        ort.env.wasm.wasmPaths = assetBase;
        // Electron renderer lacks cross-origin isolation; threaded WASM fails without this.
        ort.env.wasm.numThreads = 1;
      },
      onSpeechStart: () => {
        runCallback(options.onSpeechStart);
      },
      onSpeechEnd: () => {
        runCallback(options.onSpeechEnd);
      },
      onVADMisfire: () => {
        if (options.onMisfire) runCallback(options.onMisfire);
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '语音活动检测初始化失败';
    options.onError?.(message);
    throw new Error(message);
  }

  if (micVad.errored) {
    const message = micVad.errored;
    await micVad.destroy().catch(() => undefined);
    micVad = null;
    options.onError?.(message);
    throw new Error(message);
  }

  return {
    async start() {
      if (!micVad || micVad.errored) return;
      await micVad.start();
    },
    async pause() {
      if (!micVad) return;
      await micVad.pause();
    },
    configure(threshold: number, redemptionMs: number) {
      micVad?.setOptions({
        positiveSpeechThreshold: threshold,
        redemptionMs,
      });
    },
    async destroy() {
      if (!micVad) return;
      await micVad.destroy();
      micVad = null;
    },
  };
}
