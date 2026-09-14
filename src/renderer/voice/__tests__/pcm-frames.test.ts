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

/**
 * 差分测试：splitPcmFrames 是从 useVoiceInput.pushPcmFrame 里抽出来的，
 * 而 useVoiceInput 同时被语音通话使用。这里把抽取前的实现原样重建为对照，
 * 断言两者在成功路径上逐字节等价——否则通话的流式 STT 会收到错位的音频。
 */
function legacyPush(buffered: PcmBytes, incoming: PcmBytes, frameBytes: number) {
  const merged = new Uint8Array(buffered.byteLength + incoming.byteLength);
  merged.set(buffered, 0);
  merged.set(incoming, buffered.byteLength);
  let rest: Uint8Array = merged;
  const sent: Uint8Array[] = [];
  while (rest.byteLength >= frameBytes) {
    sent.push(rest.slice(0, frameBytes));
    rest = rest.slice(frameBytes);
  }
  return { sent, rest };
}

/** 固定种子的伪随机，保证用例可复现，不引入 flaky。 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('pcm framing matches the pre-extraction implementation', () => {
  const FRAME_BYTES = 3200; // 与 STT_FRAME_BYTES 一致

  it('produces byte-identical frames and remainder across randomized chunk sequences', () => {
    const random = makeRandom(20260913);
    for (let round = 0; round < 40; round += 1) {
      let newBuffer: PcmBytes = new Uint8Array(0);
      let oldBuffer: PcmBytes = new Uint8Array(0);
      const newSent: number[] = [];
      const oldSent: number[] = [];
      const allInput: number[] = [];

      for (let step = 0; step < 12; step += 1) {
        // 覆盖不足一帧、恰好一帧、跨多帧三种块长
        const size = Math.floor(random() * 5000);
        const chunk = new Uint8Array(size);
        for (let i = 0; i < size; i += 1) chunk[i] = Math.floor(random() * 256);
        allInput.push(...chunk);

        const next = splitPcmFrames(newBuffer, chunk, FRAME_BYTES);
        newSent.push(...next.frames.flatMap((f) => [...f]));
        newBuffer = next.remainder;

        const legacy = legacyPush(oldBuffer, chunk, FRAME_BYTES);
        oldSent.push(...legacy.sent.flatMap((f) => [...f]));
        oldBuffer = legacy.rest as PcmBytes;
      }

      expect(newSent).toEqual(oldSent);
      expect([...newBuffer]).toEqual([...oldBuffer]);
      // 不丢字节、不乱序：发出去的 + 留在缓冲里的 == 全部输入
      expect([...newSent, ...newBuffer]).toEqual(allInput);
    }
  });

  it('sends every frame at exactly the required size', () => {
    const random = makeRandom(7);
    let buffer: PcmBytes = new Uint8Array(0);
    for (let step = 0; step < 20; step += 1) {
      const size = Math.floor(random() * 9000);
      const { frames, remainder } = splitPcmFrames(buffer, new Uint8Array(size), FRAME_BYTES);
      for (const frame of frames) {
        expect(frame.byteLength).toBe(FRAME_BYTES);
        // 送进 IPC 的是 frame.buffer，必须正好一帧大小，不能是底层大 buffer 的视图
        expect(frame.buffer.byteLength).toBe(FRAME_BYTES);
      }
      expect(remainder.byteLength).toBeLessThan(FRAME_BYTES);
      buffer = remainder;
    }
  });
});
