import { describe, expect, it } from 'vitest';
import { PCM_BYTES_PER_MS, PcmPreRollBuffer, PRE_ROLL_MS } from '../pre-roll-buffer';

function bytes(n: number, fill: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(n)).fill(fill);
}

describe('PcmPreRollBuffer', () => {
  it('keeps everything while under capacity and drains in order', () => {
    const buf = new PcmPreRollBuffer(10);
    buf.push(bytes(3, 1));
    buf.push(bytes(4, 2));
    expect(buf.byteLength).toBe(7);
    const out = buf.drain();
    expect(Array.from(out)).toEqual([1, 1, 1, 2, 2, 2, 2]);
    expect(buf.byteLength).toBe(0);
  });

  it('drops the oldest whole chunks once capacity is exceeded', () => {
    const buf = new PcmPreRollBuffer(6);
    buf.push(bytes(3, 1));
    buf.push(bytes(3, 2));
    buf.push(bytes(2, 3));
    expect(buf.byteLength).toBe(5);
    expect(Array.from(buf.drain())).toEqual([2, 2, 2, 3, 3]);
  });

  it('always keeps the newest chunk even if it alone exceeds capacity', () => {
    const buf = new PcmPreRollBuffer(4);
    buf.push(bytes(2, 1));
    buf.push(bytes(9, 2));
    expect(buf.byteLength).toBe(9);
    expect(buf.drain().byteLength).toBe(9);
  });

  it('drain returns a view covering exactly its own ArrayBuffer (safe for IPC)', () => {
    const buf = new PcmPreRollBuffer(100);
    const big = new Uint8Array(new ArrayBuffer(50)).fill(7);
    buf.push(big.subarray(10, 20));
    const out = buf.drain();
    expect(out.byteOffset).toBe(0);
    expect(out.byteLength).toBe(out.buffer.byteLength);
    expect(out.byteLength).toBe(10);
  });

  it('ignores empty chunks and rejects a non-positive capacity', () => {
    const buf = new PcmPreRollBuffer(4);
    buf.push(bytes(0, 0));
    expect(buf.byteLength).toBe(0);
    expect(() => new PcmPreRollBuffer(0)).toThrow();
  });

  it('default pre-roll covers at least several VAD frames', () => {
    // vad-web 一帧 1536 样本 ≈ 96 ms；前导至少要盖住 3 帧才有意义。
    expect(PRE_ROLL_MS).toBeGreaterThanOrEqual(96 * 3);
    expect(PRE_ROLL_MS * PCM_BYTES_PER_MS).toBe(22_400);
  });
});
