import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/voice', () => ({
  resolveVoiceApiKey: vi.fn(() => 'sk-test'),
  resolveTtsWsEndpoint: vi.fn(() => 'wss://example.com/tts'),
}));

import { createTtsStreamSession } from '../bailian-tts-stream';
import type { SttSocket, SttSocketEventMap } from '../bailian-stt';
import type { TtsOptions } from '../types';

const OPTS: TtsOptions = {
  model: 'cosyvoice-v3.5-plus',
  voiceId: 'cloned-voice-id',
  rate: 1,
  volume: 100,
  format: 'mp3',
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
}

function evt(event: string): { data: string } {
  return { data: JSON.stringify({ header: { event } }) };
}

function makeFactory(): { getSocket: () => FakeSocket; factory: (endpoint: string, apiKey: string) => FakeSocket } {
  let socket: FakeSocket | undefined;
  const factory = (_endpoint: string, _apiKey: string) => {
    socket = new FakeSocket();
    return socket;
  };
  return {
    getSocket: () => {
      if (!socket) throw new Error('socket not created');
      return socket;
    },
    factory,
  };
}

describe('createTtsStreamSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs task, pushes text, emits binary audio, and finishes', async () => {
    const { factory, getSocket } = makeFactory();
    const chunks: Array<{ seq: number; size: number }> = [];

    const sessionPromise = createTtsStreamSession(
      OPTS,
      {
        onAudioChunk: (audio, seq) => chunks.push({ seq, size: audio.byteLength }),
        onError: () => undefined,
      },
      factory,
    );

    const socket = getSocket();
    socket.fire('open');

    const runTask = JSON.parse(socket.strings[0]) as { header: { action: string } };
    expect(runTask.header.action).toBe('run-task');

    socket.fire('message', evt('task-started'));
    const session = await sessionPromise;

    await session.pushText('你好。');
    const continueTask = JSON.parse(socket.strings[1]) as {
      header: { action: string };
      payload: { input: { text: string } };
    };
    expect(continueTask.header.action).toBe('continue-task');
    expect(continueTask.payload.input.text).toBe('你好。');

    socket.fire('message', { data: new Uint8Array([1, 2, 3]).buffer });
    expect(chunks).toEqual([{ seq: 0, size: 3 }]);

    const finishP = session.finish();
    await Promise.resolve();
    const finishTask = socket.strings
      .map((s) => JSON.parse(s) as { header: { action: string } })
      .find((m) => m.header.action === 'finish-task');
    expect(finishTask?.header.action).toBe('finish-task');
    socket.fire('message', evt('task-finished'));
    await finishP;
  });

  it('abort stops further chunks', async () => {
    const { factory, getSocket } = makeFactory();
    const chunks: number[] = [];

    const sessionPromise = createTtsStreamSession(
      OPTS,
      {
        onAudioChunk: (_audio, seq) => chunks.push(seq),
        onError: () => undefined,
      },
      factory,
    );

    const socket = getSocket();
    socket.fire('open');
    socket.fire('message', evt('task-started'));
    const session = await sessionPromise;

    session.abort();
    socket.fire('message', { data: new Uint8Array([9]).buffer });
    expect(chunks).toEqual([]);
    expect(socket.closed).toBe(true);
  });
});
