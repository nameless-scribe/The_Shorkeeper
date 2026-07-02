import type { SttOptions, SttResult } from './types';

export interface SttEngine {
  /**
   * Transcribe a single utterance of raw PCM (16-bit LE mono) to text.
   * One-shot: opens a session, streams the audio, returns the final transcript.
   */
  transcribe(pcm: ArrayBuffer, options: SttOptions): Promise<SttResult>;
}

export type { SttStreamSession, SttStreamHandlers } from './bailian-stt';
export { createSttStreamSession } from './bailian-stt';
