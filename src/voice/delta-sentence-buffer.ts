import {
  hasSpeakableCharacters,
  prepareChunkForTts,
  stripMarkdownForSpeech,
} from './text-for-speech';

const SENTENCE_END = /[。！？!?…\n]/;

/** Accumulates streaming text_delta and emits speakable sentence chunks. */
export class DeltaSentenceBuffer {
  private buffer = '';

  append(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;
    return this.drainComplete();
  }

  flush(): string[] {
    const tail = this.buffer.trim();
    this.buffer = '';
    if (!tail) return [];
    const speakable = stripMarkdownForSpeech(tail);
    const prepared = prepareChunkForTts(speakable);
    if (!prepared || !hasSpeakableCharacters(prepared)) return [];
    return [prepared];
  }

  private drainComplete(): string[] {
    const ready: string[] = [];
    let start = 0;

    for (let i = 0; i < this.buffer.length; i += 1) {
      if (!SENTENCE_END.test(this.buffer[i])) continue;

      const raw = this.buffer.slice(start, i + 1);
      start = i + 1;
      const speakable = stripMarkdownForSpeech(raw);
      const prepared = prepareChunkForTts(speakable);
      if (prepared && hasSpeakableCharacters(prepared)) {
        ready.push(prepared);
      }
    }

    if (start > 0) {
      this.buffer = this.buffer.slice(start);
    }
    return ready;
  }
}
