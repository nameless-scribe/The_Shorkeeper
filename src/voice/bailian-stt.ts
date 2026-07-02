import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { resolveSttWsEndpoint, resolveVoiceApiKey } from '../config/voice';
import type { SttEngine } from './stt-engine';
import type { SttOptions, SttResult } from './types';
import { STT_FRAME_BYTES } from './types';

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

export interface SttStreamHandlers {
  onPartial?: (text: string) => void;
}

export interface SttStreamSession {
  pushPcm(chunk: ArrayBuffer | ArrayBufferView): void;
  finish(): Promise<SttResult>;
  abort(): void;
}

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

function defaultSocketFactory(endpoint: string, apiKey: string): SttSocket {
  const socket = new WebSocket(endpoint, {
    headers: {
      Authorization: `bearer ${apiKey}`,
      'X-DashScope-DataInspection': 'enable',
    },
  });
  return socket as unknown as SttSocket;
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

export function createSttStreamSession(
  options: SttOptions,
  handlers: SttStreamHandlers = {},
  socketFactory: SttSocketFactory = defaultSocketFactory,
): Promise<SttStreamSession> {
  const apiKey = resolveVoiceApiKey();
  if (!apiKey) {
    return Promise.reject(
      new Error('未配置语音 API Key。请在 设置 → API 设置 填写百炼 Key，或设置 VOICE_API_KEY'),
    );
  }

  const endpoint = resolveSttWsEndpoint();
  const taskId = randomUUID();
  const socket = socketFactory(endpoint, apiKey);

  let settled = false;
  let started = false;
  let aborted = false;
  let finished = false;
  let finishRequested = false;
  const finalized: string[] = [];
  let lastPartial = '';

  let startedResolve: (() => void) | null = null;
  let startedReject: ((err: Error) => void) | null = null;
  let finishResolve: ((result: SttResult) => void) | null = null;
  let finishReject: ((err: Error) => void) | null = null;

  const startedPromise = new Promise<void>((resolve, reject) => {
    startedResolve = resolve;
    startedReject = reject;
  });

  const finishPromise = new Promise<SttResult>((resolve, reject) => {
    finishResolve = resolve;
    finishReject = reject;
  });

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

  const fail = (err: Error) => {
    if (settled || aborted) return;
    settled = true;
    cleanup();
    if (startedReject) {
      startedReject(err);
    } else {
      startedResolve?.();
    }
    startedResolve = null;
    startedReject = null;
    if (finishRequested) {
      finishReject?.(err);
    }
    finishResolve = null;
    finishReject = null;
  };

  const complete = () => {
    if (settled) return;
    settled = true;
    finished = true;
    cleanup();
    const text = (finalized.join('') || lastPartial).trim();
    startedResolve?.();
    startedResolve = null;
    startedReject = null;
    finishResolve?.({ text });
    finishResolve = null;
    finishReject = null;
  };

  socket.addEventListener('open', () => {
    if (aborted) return;
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
    if (aborted) return;

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
      startedResolve?.();
      startedResolve = null;
      startedReject = null;
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
        if (text) handlers.onPartial?.(text);
      }
      return;
    }

    if (event === 'task-finished') {
      complete();
      return;
    }

    if (event === 'task-failed') {
      const message = msg.header?.error_message ?? '语音识别失败';
      fail(mapSttError(message, msg.header?.error_code));
    }
  });

  socket.addEventListener('error', () => {
    if (!aborted && !finished) {
      fail(new Error('语音识别连接错误，请检查网络与百炼语音服务是否开通'));
    }
  });

  socket.addEventListener('close', () => {
    if (aborted || finished) return;
    if (!started) {
      fail(new Error('语音识别连接被关闭，请检查 API Key 与接入地址'));
      return;
    }
    complete();
  });

  const session: SttStreamSession = {
    pushPcm(chunk) {
      if (aborted || settled) return;
      if (chunk.byteLength === 0) return;
      socket.send(chunk);
    },

    async finish() {
      if (aborted) return { text: '' };
      if (finished) {
        return finishPromise.catch(() => ({ text: '' }));
      }
      finishRequested = true;
      await startedPromise;
      socket.send(
        JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }),
      );
      return finishPromise;
    },

    abort() {
      if (aborted) return;
      aborted = true;
      cleanup();
      startedResolve?.();
      startedResolve = null;
      startedReject = null;
      finishResolve?.({ text: '' });
      finishResolve = null;
      finishReject = null;
    },
  };

  return startedPromise.then(() => session);
}

export class BailianSttEngine implements SttEngine {
  constructor(private readonly socketFactory: SttSocketFactory = defaultSocketFactory) {}

  async transcribe(pcm: ArrayBuffer, options: SttOptions): Promise<SttResult> {
    if (pcm.byteLength === 0) {
      throw new Error('录音数据为空');
    }

    const session = await createSttStreamSession(options, {}, this.socketFactory);
    const bytes = new Uint8Array(pcm);
    for (let offset = 0; offset < bytes.byteLength; offset += STT_FRAME_BYTES) {
      const end = Math.min(offset + STT_FRAME_BYTES, bytes.byteLength);
      session.pushPcm(bytes.slice(offset, end));
    }
    return session.finish();
  }
}

let defaultEngine: BailianSttEngine | null = null;

export function getBailianSttEngine(): BailianSttEngine {
  if (!defaultEngine) defaultEngine = new BailianSttEngine();
  return defaultEngine;
}

/** @deprecated Use STT_FRAME_BYTES from ./types */
export { STT_FRAME_BYTES, STT_FRAME_BYTES as FRAME_BYTES } from './types';
