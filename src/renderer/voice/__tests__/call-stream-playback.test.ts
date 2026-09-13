import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppendQueue } from '../call-stream-append-queue';
import { SeqChunkCollector } from '../call-stream-seq-collector';
import { createCallStreamPlayback, mergeAudioChunks } from '../call-stream-playback';
import { stopAllSpeechPlayback } from '../speech-playback-coordinator';

afterEach(() => {
  stopAllSpeechPlayback();
  vi.unstubAllGlobals();
});

describe('mergeAudioChunks', () => {
  it('concatenates chunks in order', () => {
    const merged = new Uint8Array(
      mergeAudioChunks([
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5]),
      ]),
    );
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns empty buffer for no chunks', () => {
    expect(mergeAudioChunks([]).byteLength).toBe(0);
  });
});

describe('SeqChunkCollector', () => {
  it('emits chunks in seq order', () => {
    const collector = new SeqChunkCollector();
    collector.add(1, new Uint8Array([2]).buffer);
    collector.add(0, new Uint8Array([1]).buffer);
    const ready = collector.drainOrdered();
    expect(ready).toHaveLength(2);
    expect(Array.from(ready[0])).toEqual([1]);
    expect(Array.from(ready[1])).toEqual([2]);
    expect(collector.drainOrdered()).toEqual([]);
  });

  it('waits for missing seq', () => {
    const collector = new SeqChunkCollector();
    collector.add(1, new Uint8Array([2]).buffer);
    expect(collector.drainOrdered()).toEqual([]);
    expect(collector.hasSeqGap()).toBe(true);
    collector.add(0, new Uint8Array([1]).buffer);
    const ready = collector.drainOrdered();
    expect(ready).toHaveLength(2);
    expect(collector.hasSeqGap()).toBe(false);
  });

  it('drains arrived chunks in order after a terminal sequence gap', () => {
    const collector = new SeqChunkCollector();
    collector.add(2, new Uint8Array([3]).buffer);
    collector.add(1, new Uint8Array([2]).buffer);

    expect(collector.drainRemaining().map((chunk) => [...chunk])).toEqual([[2], [3]]);
    expect(collector.hasSeqGap()).toBe(false);
  });
});

describe('AppendQueue', () => {
  it('flushes one chunk when not updating', () => {
    const queue = new AppendQueue();
    queue.push(new Uint8Array([1, 2]));
    const appended: number[] = [];
    const did = queue.flush(false, (chunk) => {
      appended.push(...chunk);
    });
    expect(did).toBe(true);
    expect(appended).toEqual([1, 2]);
    expect(queue.isEmpty).toBe(true);
  });

  it('does not flush while updating', () => {
    const queue = new AppendQueue();
    queue.push(new Uint8Array([1]));
    const did = queue.flush(true, () => undefined);
    expect(did).toBe(false);
    expect(queue.isEmpty).toBe(false);
  });

  it('shouldEndStream only when ended, drained, and idle', () => {
    const queue = new AppendQueue();
    queue.markStreamEnded();
    expect(queue.shouldEndStream(false, false)).toBe(true);
    queue.push(new Uint8Array([1]));
    expect(queue.shouldEndStream(false, false)).toBe(false);
    expect(queue.shouldEndStream(true, false)).toBe(false);
    expect(queue.shouldEndStream(false, true)).toBe(false);
  });
});

describe('fallback call playback lifecycle', () => {
  function installAudioContext() {
    const close = vi.fn(async () => undefined);
    class FakeAudioContext {
      state = 'running';
      destination = {};
      createGain() {
        return { gain: { value: 1 }, connect: vi.fn() };
      }
      async resume() {}
      async close() {
        await close();
      }
      async decodeAudioData() {
        return {} as AudioBuffer;
      }
      createBufferSource() {
        const source = {
          buffer: null as AudioBuffer | null,
          connect: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
          start: () => queueMicrotask(() => source.onended?.()),
        };
        return source;
      }
    }
    vi.stubGlobal('MediaSource', undefined);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    return close;
  }

  it('closes its AudioContext after normal playback completion', async () => {
    const close = installAudioContext();
    const playback = createCallStreamPlayback(1);
    playback.startRound();
    playback.enqueue(0, new Uint8Array([1, 2, 3]).buffer);
    playback.markStreamEnd();

    await playback.waitForPlaybackEnd();
    expect(close).toHaveBeenCalledOnce();
  });

  it('finishes instead of hanging when the terminal stream has a missing chunk', async () => {
    const close = installAudioContext();
    const playback = createCallStreamPlayback(1);
    playback.startRound();
    playback.enqueue(1, new Uint8Array([2]).buffer);
    playback.markStreamEnd();

    await playback.waitForPlaybackEnd();
    expect(close).toHaveBeenCalledOnce();
  });
});
