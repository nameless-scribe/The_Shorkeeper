import type { TtsOptions, TtsResult } from './types';

export interface TtsEngine {
  synthesize(text: string, options: TtsOptions): Promise<TtsResult>;
}
