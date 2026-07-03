type MammothModule = typeof import('mammoth');

/** mammoth 为 CJS；统一从 default 或命名空间取 API */
export async function loadMammoth(): Promise<MammothModule> {
  const mod = await import('mammoth');
  return (mod as { default?: MammothModule }).default ?? mod;
}

type WordExtractorCtor = new () => {
  extract: (path: string) => Promise<{ getBody: () => string }>;
};

/** word-extractor 为 CJS；构造函数在 default 上 */
export async function loadWordExtractor(): Promise<WordExtractorCtor> {
  const mod = await import('word-extractor');
  const Ctor = (mod as { default?: unknown }).default ?? mod;
  if (typeof Ctor === 'function') {
    return Ctor as WordExtractorCtor;
  }
  return (Ctor as { default: WordExtractorCtor }).default;
}
