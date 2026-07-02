import { describe, expect, it } from 'vitest';
import { AppendQueue } from '../call-stream-append-queue';
import { SeqChunkCollector } from '../call-stream-seq-collector';
import { mergeAudioChunks } from '../call-stream-playback';

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
