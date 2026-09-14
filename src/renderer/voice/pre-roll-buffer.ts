/**
 * 录音"前导"环形缓冲的纯逻辑。
 *
 * 全双工通话里，VAD 判定"开始说话"总比真正开口晚一两百毫秒，
 * 此前通话页要等 VAD 触发后才开麦、建流，开口的头几个字就丢了。
 * 现在麦克风在通话期间常开，空闲时把最近一小段 PCM 留在这里；
 * VAD 一触发，先把这段前导送进识别流，再接实时音频。
 *
 * 单独抽出来是为了让"保留多少、丢多少"可以用纯函数测清楚。
 */

import { concatPcm, type PcmBytes } from './pcm-frames';

/** 16 kHz / 16 bit / 单声道：每毫秒 32 字节。 */
export const PCM_BYTES_PER_MS = 32;

/** 前导时长。要盖住 VAD 的判定延迟（约 1–2 帧，每帧 96 ms）再留余量；过长只是多送一点静音。 */
export const PRE_ROLL_MS = 700;

export class PcmPreRollBuffer {
  private chunks: PcmBytes[] = [];
  private total = 0;

  constructor(private readonly capacityBytes: number) {
    if (!Number.isInteger(capacityBytes) || capacityBytes <= 0) {
      throw new Error(`前导容量必须是正整数字节数，收到 ${capacityBytes}`);
    }
  }

  get byteLength(): number {
    return this.total;
  }

  /** 追加一块；超出容量时从最旧的整块开始丢，直到不超过容量（至少保留最新一块）。 */
  push(chunk: PcmBytes): void {
    if (chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    this.total += chunk.byteLength;
    while (this.total > this.capacityBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.total -= dropped.byteLength;
    }
  }

  /** 取出全部前导并清空。返回的视图恰好覆盖整个底层 ArrayBuffer，可直接经 IPC 发送。 */
  drain(): PcmBytes {
    let merged: PcmBytes = new Uint8Array(0);
    for (const chunk of this.chunks) merged = concatPcm(merged, chunk);
    this.clear();
    if (merged.byteOffset === 0 && merged.byteLength === merged.buffer.byteLength) return merged;
    return merged.slice();
  }

  clear(): void {
    this.chunks = [];
    this.total = 0;
  }
}
