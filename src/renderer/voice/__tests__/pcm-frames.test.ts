import { describe, expect, it } from 'vitest';
import { concatPcm, splitPcmFrames, type PcmBytes } from '../pcm-frames';

const FRAME = 4;

function bytes(...values: number[]): PcmBytes {
  return new Uint8Array(values);
}

function flatten(frames: PcmBytes[]): number[] {
  return frames.flatMap((frame) => [...frame]);
}

describe('pcm framing', () => {
  it('keeps everything as remainder while a frame is not full yet', () => {
    const { frames, remainder } = splitPcmFrames(new Uint8Array(0), bytes(1, 2, 3), FRAME);
    expect(frames).toEqual([]);
    expect([...remainder]).toEqual([1, 2, 3]);
  });

  it('emits exact frames and carries the leftover to the next call', () => {
    const first = splitPcmFrames(new Uint8Array(0), bytes(1, 2, 3, 4, 5, 6), FRAME);
    expect(flatten(first.frames)).toEqual([1, 2, 3, 4]);
    expect([...first.remainder]).toEqual([5, 6]);

    const second = splitPcmFrames(first.remainder, bytes(7, 8, 9), FRAME);
    expect(flatten(second.frames)).toEqual([5, 6, 7, 8]);
    expect([...second.remainder]).toEqual([9]);
  });

  it('leaves no remainder when the input lands exactly on a frame boundary', () => {
    const { frames, remainder } = splitPcmFrames(bytes(1, 2), bytes(3, 4, 5, 6, 7, 8), FRAME);
    expect(flatten(frames)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(remainder.byteLength).toBe(0);
  });

  it('preserves byte order across many small chunks', () => {
    const source = Array.from({ length: 23 }, (_, i) => i + 1);
    let remainder = new Uint8Array(0);
    const sent: number[] = [];
    for (const value of source) {
      const split = splitPcmFrames(remainder, bytes(value), FRAME);
      sent.push(...flatten(split.frames));
      remainder = split.remainder;
    }
    // 23 = 5 帧 * 4 + 3 余数，且顺序不能乱
    expect(sent).toEqual(source.slice(0, 20));
    expect([...remainder]).toEqual([21, 22, 23]);
  });

  it('does not mutate its inputs', () => {
    const buffered = bytes(1, 2, 3);
    const incoming = bytes(4, 5, 6);
    splitPcmFrames(buffered, incoming, FRAME);
    expect([...buffered]).toEqual([1, 2, 3]);
    expect([...incoming]).toEqual([4, 5, 6]);
  });

  it('rejects a nonsensical frame size instead of looping forever', () => {
    expect(() => splitPcmFrames(new Uint8Array(0), bytes(1), 0)).toThrow('帧长');
    expect(() => splitPcmFrames(new Uint8Array(0), bytes(1), -4)).toThrow('帧长');
  });

  it('avoids copying when one side is empty', () => {
    const incoming = bytes(1, 2);
    expect(concatPcm(new Uint8Array(0), incoming)).toBe(incoming);
    const buffered = bytes(3, 4);
    expect(concatPcm(buffered, new Uint8Array(0))).toBe(buffered);
  });
});
