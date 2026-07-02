import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/voice', () => ({
  resolveVoiceApiKey: vi.fn(() => 'sk-test'),
  resolveSttWsEndpoint: vi.fn(() => 'wss://example.com/stt'),
}));

import { resolveVoiceApiKey } from '../../config/voice';
import { BailianSttEngine, type SttSocket, type SttSocketEventMap } from '../bailian-stt';
import type { SttOptions } from '../types';

const OPTS: SttOptions = {
  model: 'paraformer-realtime-v2',
  sampleRate: 16000,
  languageHints: ['zh'],
};

class FakeSocket implements SttSocket {
  sent: Array<string | ArrayBufferView | ArrayBuffer> = [];
  closed = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners: Record<string, Array<(ev: any) => void>> = {};

  send(data: string | ArrayBufferView | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener<K extends keyof SttSocketEventMap>(
    type: K,
    cb: (ev: SttSocketEventMap[K]) => void,
  ): void {
    (this.listeners[type] ??= []).push(cb as (ev: unknown) => void);
  }

  fire<K extends keyof SttSocketEventMap>(type: K, ev?: SttSocketEventMap[K]): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }

  get strings(): string[] {
    return this.sent.filter((s): s is string => typeof s === 'string');
  }

  get binaryFrames(): ArrayBufferView[] {
    return this.sent.filter((s): s is ArrayBufferView => ArrayBuffer.isView(s));
  }
}

function evt(event: string, sentence?: { text?: string; sentence_end?: boolean }): { data: string } {
  return {
    data: JSON.stringify({
      header: { event },
      ...(sentence ? { payload: { output: { sentence } } } : {}),
    }),
  };
}

function makeEngine(): { engine: BailianSttEngine; getSocket: () => FakeSocket } {
  let socket: FakeSocket | undefined;
  const engine = new BailianSttEngine(() => {
    socket = new FakeSocket();
    return socket;
  });
  return {
    engine,
    getSocket: () => {
      if (!socket) throw new Error('socket not created');
      return socket;
    },
  };
}

describe('BailianSttEngine', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('transcribes a full utterance and streams pcm frames', async () => {
    const { engine, getSocket } = makeEngine();
    const pcm = new Uint8Array(8000).fill(7).buffer; // 3 frames: 3200 + 3200 + 1600

    const promise = engine.transcribe(pcm, OPTS);
    const socket = getSocket();

    socket.fire('open');

    // run-task sent on open
    const runTask = JSON.parse(socket.strings[0]) as any;
    expect(runTask.header.action).toBe('run-task');
    expect(runTask.payload.model).toBe('paraformer-realtime-v2');
    expect(runTask.payload.parameters.format).toBe('pcm');
    expect(runTask.payload.parameters.sample_rate).toBe(16000);
    expect(runTask.payload.parameters.language_hints).toEqual(['zh']);

    socket.fire('message', evt('task-started'));

    // audio frames + finish-task sent after task-started
    expect(socket.binaryFrames).toHaveLength(3);
    const finishTask = JSON.parse(socket.strings[socket.strings.length - 1]) as any;
    expect(finishTask.header.action).toBe('finish-task');

    socket.fire('message', evt('result-generated', { text: '你好', sentence_end: true }));
    socket.fire('message', evt('task-finished'));

    const result = await promise;
    expect(result.text).toBe('你好');
    expect(socket.closed).toBe(true);
  });

  it('concatenates multiple final sentences and ignores partials', async () => {
    const { engine, getSocket } = makeEngine();
    const promise = engine.transcribe(new Uint8Array([1, 2, 3, 4]).buffer, OPTS);
    const socket = getSocket();

    socket.fire('open');
    socket.fire('message', evt('task-started'));
    socket.fire('message', evt('result-generated', { text: '你好', sentence_end: false }));
    socket.fire('message', evt('result-generated', { text: '你好世界', sentence_end: true }));
    socket.fire('message', evt('result-generated', { text: '再见', sentence_end: true }));
    socket.fire('message', evt('task-finished'));

    const result = await promise;
    expect(result.text).toBe('你好世界再见');
  });

  it('rejects when task-failed is received', async () => {
    const { engine, getSocket } = makeEngine();
    const promise = engine.transcribe(new Uint8Array([1, 2]).buffer, OPTS);
    const socket = getSocket();

    socket.fire('open');
    socket.fire('message', {
      data: JSON.stringify({
        header: { event: 'task-failed', error_code: 'CLIENT_ERROR', error_message: 'boom' },
      }),
    });

    await expect(promise).rejects.toThrow('boom');
    expect(socket.closed).toBe(true);
  });

  it('maps invalid api key errors to a friendly message', async () => {
    const { engine, getSocket } = makeEngine();
    const promise = engine.transcribe(new Uint8Array([1, 2]).buffer, OPTS);
    const socket = getSocket();

    socket.fire('open');
    socket.fire('message', {
      data: JSON.stringify({
        header: { event: 'task-failed', error_message: 'Invalid API-key provided' },
      }),
    });

    await expect(promise).rejects.toThrow(/Key 无效/);
  });

  it('rejects when the socket closes before task-started', async () => {
    const { engine, getSocket } = makeEngine();
    const promise = engine.transcribe(new Uint8Array([1, 2]).buffer, OPTS);
    const socket = getSocket();

    socket.fire('open');
    socket.fire('close', {});

    await expect(promise).rejects.toThrow(/连接被关闭/);
  });

  it('rejects when api key is missing without opening a socket', async () => {
    vi.mocked(resolveVoiceApiKey).mockReturnValueOnce('');
    const engine = new BailianSttEngine(() => {
      throw new Error('socket should not be created');
    });
    await expect(engine.transcribe(new Uint8Array([1, 2]).buffer, OPTS)).rejects.toThrow(/API Key/);
  });

  it('rejects empty audio without opening a socket', async () => {
    const engine = new BailianSttEngine(() => {
      throw new Error('socket should not be created');
    });
    await expect(engine.transcribe(new ArrayBuffer(0), OPTS)).rejects.toThrow(/为空/);
  });
});
