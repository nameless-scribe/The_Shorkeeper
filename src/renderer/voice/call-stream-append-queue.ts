/** Serializes Uint8Array chunks for a single SourceBuffer (one append at a time). */
export class AppendQueue {
  private queue: Uint8Array[] = [];
  private streamEnded = false;

  reset(): void {
    this.queue = [];
    this.streamEnded = false;
  }

  push(...chunks: Uint8Array[]): void {
    if (chunks.length > 0) {
      this.queue.push(...chunks);
    }
  }

  markStreamEnded(): void {
    this.streamEnded = true;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  get isStreamEnded(): boolean {
    return this.streamEnded;
  }

  /** Returns true if a chunk was handed to append(). */
  flush(updating: boolean, append: (chunk: Uint8Array) => void): boolean {
    if (updating || this.queue.length === 0) return false;
    append(this.queue.shift()!);
    return true;
  }

  /** True when stream ended, queue drained, and SourceBuffer is idle. */
  shouldEndStream(updating: boolean, hasSeqGap: boolean): boolean {
    return this.streamEnded && !hasSeqGap && this.queue.length === 0 && !updating;
  }

  clear(): void {
    this.queue = [];
    this.streamEnded = false;
  }
}
