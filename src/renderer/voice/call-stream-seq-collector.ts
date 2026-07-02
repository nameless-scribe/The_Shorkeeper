/** Collects out-of-order call_audio_chunk buffers and emits contiguous seq runs. */
export class SeqChunkCollector {
  private pending = new Map<number, ArrayBuffer>();
  private nextSeq = 0;

  reset(): void {
    this.pending.clear();
    this.nextSeq = 0;
  }

  add(seq: number, audio: ArrayBuffer): void {
    this.pending.set(seq, audio);
  }

  drainOrdered(): Uint8Array[] {
    const ready: Uint8Array[] = [];
    while (this.pending.has(this.nextSeq)) {
      ready.push(new Uint8Array(this.pending.get(this.nextSeq)!));
      this.pending.delete(this.nextSeq);
      this.nextSeq += 1;
    }
    return ready;
  }

  /** True when chunks are waiting but the next expected seq has not arrived yet. */
  hasSeqGap(): boolean {
    return this.pending.size > 0;
  }

  clear(): void {
    this.pending.clear();
  }
}
