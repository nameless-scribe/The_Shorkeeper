import type { TtsOptions, TtsResult } from './types';

export interface TtsEngine {
  synthesize(text: string, options: TtsOptions, signal?: AbortSignal): Promise<TtsResult>;
}

export type { TtsStreamSession, TtsStreamHandlers } from './bailian-tts-stream';
export { createTtsStreamSession } from './bailian-tts-stream';
