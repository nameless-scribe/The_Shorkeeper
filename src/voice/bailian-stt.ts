import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { resolveSttWsEndpoint, resolveVoiceApiKey } from '../config/voice';
import type { SttEngine } from './stt-engine';
import type { SttOptions, SttResult } from './types';

/**
 * Minimal WebSocket surface used by the engine. Matches both the `ws`
 * package and the browser WebSocket, so tests can inject a fake.
 */
export interface SttSocketEventMap {
  open: void;
  message: { data: unknown };
  error: unknown;
  close: { code?: number; reason?: string };
}

export interface SttSocket {
  send(data: string | ArrayBufferView | ArrayBuffer): void;
  close(): void;
  addEventListener<K extends keyof SttSocketEventMap>(
    type: K,
    cb: (ev: SttSocketEventMap[K]) => void,
  ): void;
}

export type SttSocketFactory = (endpoint: string, apiKey: string) => SttSocket;

interface ParaformerEvent {
  header?: {
    event?: 'task-started' | 'result-generated' | 'task-finished' | 'task-failed';
    error_code?: string;
    error_message?: string;
  };
  payload?: {
    output?: {
      sentence?: {
        text?: string;
        sentence_end?: boolean;
      };
    };
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** Paraformer accepts ~100ms audio frames; 16kHz * 16bit mono => 3200 bytes / 100ms. */
const FRAME_BYTES = 3200;

function defaultSocketFactory(endpoint: string, apiKey: string): SttSocket {
  const socket = new WebSocket(endpoint, {
    headers: {
      Authorization: `bearer ${apiKey}`,
      'X-DashScope-DataInspection': 'enable',
    },
  });
  return socket as unknown as SttSocket;
}

export class BailianSttEngine implements SttEngine {
  constructor(private readonly socketFactory: SttSocketFactory = defaultSocketFactory) {}

  transcribe(pcm: ArrayBuffer, options: SttOptions): Promise<SttResult> {
    const apiKey = resolveVoiceApiKey();
    if (!apiKey) {
      return Promise.reject(
        new Error('未配置语音 API Key。请在 设置 → API 设置 填写百炼 Key，或设置 VOICE_API_KEY'),
      );
    }

    if (pcm.byteLength === 0) {
      return Promise.reject(new Error('录音数据为空'));
    }

    const endpoint = resolveSttWsEndpoint();
    const taskId = randomUUID();

    return new Promise<SttResult>((resolve, reject) => {
      const socket = this.socketFactory(endpoint, apiKey);

      let settled = false;
      let started = false;
      const finalized: string[] = [];
      let lastPartial = '';

      const timeout = setTimeout(() => {
        fail(new Error('语音识别超时（30s）'));
      }, DEFAULT_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        try {
          socket.close();
        } catch {
          // ignore close errors
        }
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const text = (finalized.join('') || lastPartial).trim();
        resolve({ text });
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
            payload: {
              task_group: 'audio',
              task: 'asr',
              function: 'recognition',
              model: options.model,
              parameters: {
                format: 'pcm',
                sample_rate: options.sampleRate,
                ...(options.languageHints?.length
                  ? { language_hints: options.languageHints }
                  : {}),
              },
              input: {},
            },
          }),
        );
      });

      socket.addEventListener('message', (ev) => {
        // Binary frames are never sent by the server for ASR; only JSON events.
        const raw = typeof ev.data === 'string' ? ev.data : bufferToString(ev.data);
        if (!raw) return;

        let msg: ParaformerEvent;
        try {
          msg = JSON.parse(raw) as ParaformerEvent;
        } catch {
          return;
        }

        const event = msg.header?.event;
        if (event === 'task-started') {
          started = true;
          streamAudio(socket, pcm, taskId);
          return;
        }

        if (event === 'result-generated') {
          const sentence = msg.payload?.output?.sentence;
          const text = sentence?.text ?? '';
          if (sentence?.sentence_end) {
            if (text) finalized.push(text);
            lastPartial = '';
          } else {
            lastPartial = text;
          }
          return;
        }

        if (event === 'task-finished') {
          finish();
          return;
        }

        if (event === 'task-failed') {
          const message = msg.header?.error_message ?? '语音识别失败';
          fail(mapSttError(message, msg.header?.error_code));
          return;
        }
      });

      socket.addEventListener('error', () => {
        fail(new Error('语音识别连接错误，请检查网络与百炼语音服务是否开通'));
      });

      socket.addEventListener('close', () => {
        // If the socket closes before task-finished, resolve with whatever we have.
        if (!started) {
          fail(new Error('语音识别连接被关闭，请检查 API Key 与接入地址'));
          return;
        }
        finish();
      });
    });
  }
}

function streamAudio(socket: SttSocket, pcm: ArrayBuffer, taskId: string): void {
  const bytes = new Uint8Array(pcm);
  for (let offset = 0; offset < bytes.byteLength; offset += FRAME_BYTES) {
    const end = Math.min(offset + FRAME_BYTES, bytes.byteLength);
    socket.send(bytes.slice(offset, end));
  }
  socket.send(
    JSON.stringify({
      header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
      payload: { input: {} },
    }),
  );
}

function bufferToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return '';
}

function mapSttError(message: string, code?: string): Error {
  if (/invalid api[- ]?key/i.test(message) || code === 'InvalidApiKey') {
    return new Error(
      '语音 API Key 无效或与接入地址不匹配。请确认百炼 Key 属北京地域，或单独设置 VOICE_API_KEY',
    );
  }
  return new Error(message);
}

let defaultEngine: BailianSttEngine | null = null;

export function getBailianSttEngine(): BailianSttEngine {
  if (!defaultEngine) defaultEngine = new BailianSttEngine();
  return defaultEngine;
}
