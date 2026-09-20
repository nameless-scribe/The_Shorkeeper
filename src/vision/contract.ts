/**
 * 视觉（P8.0，计划 §4）：参数校验、像素与 token 估算、sidecar 格式。纯函数，不引 canvas 与网络。
 */

export const VISION_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'] as const;
/** 供应商明确支持、可以原样送的格式；其余先转 PNG */
export const VISION_NATIVE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** 单图像素上限；超出缩到最长边 3600（与 P5.0 抽图上限一致，不得再低） */
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_LONG_EDGE = 3600;
export const MAX_IMAGES_PER_CALL = 6;
export const DEFAULT_MAX_TOKENS = 1_024;
export const READ_TEXT_MAX_TOKENS = 4_096;
export const MAX_QUESTION_CHARS = 2_000;
export const VISION_TIMEOUT_MS = 30_000;
/** 一次运行内的预算（§4.5） */
export const MAX_CALLS_PER_RUN = 10;
export const MAX_IMAGES_PER_RUN = 30;
export const DEFAULT_VISION_MODEL = 'qwen3-vl-plus';

export type VisionMode = 'describe' | 'read_text' | 'answer';
export const VISION_MODES: readonly VisionMode[] = ['describe', 'read_text', 'answer'];

export interface LookAtImageArgs {
  paths: string[];
  question: string;
  mode: VisionMode;
  refresh: boolean;
}

export function mimeForExtension(extension: string): string | null {
  switch (extension.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.gif':
      return 'image/gif';
    default:
      return null;
  }
}

export function isVisionImageExtension(extension: string): boolean {
  return (VISION_IMAGE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

/** 官方计费公式：宽 × 高 / (32 × 32) + 2 */
export function estimateImageTokens(width: number, height: number): number {
  return Math.ceil((width * height) / 1024) + 2;
}

/** 超出像素上限时的目标尺寸：等比缩到最长边 3600 */
export function fitWithinLimits(width: number, height: number): { width: number; height: number; resized: boolean } {
  if (width * height <= MAX_IMAGE_PIXELS && Math.max(width, height) <= MAX_LONG_EDGE * 2) return { width, height, resized: false };
  const scale = MAX_LONG_EDGE / Math.max(width, height);
  if (scale >= 1) return { width, height, resized: false };
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), resized: true };
}

export function parseLookAtImageArgs(args: unknown): { ok: true; value: LookAtImageArgs } | { ok: false; error: string } {
  const input = (args ?? {}) as { paths?: unknown; path?: unknown; question?: unknown; mode?: unknown; refresh?: unknown };
  const rawPaths = input.paths ?? (typeof input.path === 'string' ? [input.path] : undefined);
  if (!Array.isArray(rawPaths) || !rawPaths.length) return { ok: false, error: '缺少 paths：要看的图片路径（工作区相对路径，1 到 6 张）' };
  if (rawPaths.length > MAX_IMAGES_PER_CALL) return { ok: false, error: `一次最多 ${MAX_IMAGES_PER_CALL} 张，请分批` };
  const paths: string[] = [];
  for (const item of rawPaths) {
    if (typeof item !== 'string' || !item.trim()) return { ok: false, error: 'paths 每项须为非空字符串' };
    const normalized = item.trim().replace(/\\/g, '/');
    const extension = normalized.slice(normalized.lastIndexOf('.')).toLowerCase();
    if (!normalized.includes('.') || !isVisionImageExtension(extension)) {
      return { ok: false, error: `${normalized} 不是支持的图片（${VISION_IMAGE_EXTENSIONS.join(' ')}）` };
    }
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) return { ok: false, error: '缺少 question：没有问题不看图（看图要花钱）' };
  if ([...question].length > MAX_QUESTION_CHARS) return { ok: false, error: `question 过长（上限 ${MAX_QUESTION_CHARS} 字）` };
  let mode: VisionMode = 'answer';
  if (input.mode !== undefined) {
    if (typeof input.mode !== 'string' || !VISION_MODES.includes(input.mode as VisionMode)) return { ok: false, error: 'mode 只能是 describe / read_text / answer' };
    mode = input.mode as VisionMode;
  }
  if (input.refresh !== undefined && typeof input.refresh !== 'boolean') return { ok: false, error: 'refresh 须为布尔值' };
  return { ok: true, value: { paths, question, mode, refresh: input.refresh === true } };
}

/** sidecar 与图片同目录同名：描述 / 问答用 .vision.md，文字提取用 .ocr.md（§3.2） */
export function sidecarPathFor(imagePath: string, mode: VisionMode): string {
  const normalized = imagePath.replace(/\\/g, '/');
  const dot = normalized.lastIndexOf('.');
  const base = dot > normalized.lastIndexOf('/') ? normalized.slice(0, dot) : normalized;
  return `${base}${mode === 'read_text' ? '.ocr.md' : '.vision.md'}`;
}

export interface SidecarRecord {
  model: string;
  requestId: string | null;
  question: string;
  mode: VisionMode;
  /** 本次一起看的图片（相对路径） */
  images: string[];
  /** 生成答案时每张源图的 SHA-256；旧 sidecar 没有摘要时不得复用 */
  imageHashes: Record<string, string>;
  at: string;
  promptTokens: number | null;
  completionTokens: number | null;
  answer: string;
}

const HEADER_START = '<!-- shorekeeper-vision';
const HEADER_END = '-->';

export function formatSidecar(record: SidecarRecord): string {
  const header = {
    model: record.model,
    requestId: record.requestId,
    question: record.question,
    mode: record.mode,
    images: record.images,
    imageHashes: record.imageHashes,
    at: record.at,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
  };
  return `${HEADER_START}\n${JSON.stringify(header)}\n${HEADER_END}\n\n# ${record.mode === 'read_text' ? '识别文字' : '看图结果'}\n\n问题：${record.question}\n\n${record.answer.trim()}\n`;
}

export function parseSidecar(text: string): SidecarRecord | null {
  if (!text.startsWith(HEADER_START)) return null;
  const end = text.indexOf(HEADER_END);
  if (end < 0) return null;
  try {
    const header = JSON.parse(text.slice(HEADER_START.length, end).trim()) as Partial<SidecarRecord>;
    if (typeof header.question !== 'string' || typeof header.mode !== 'string') return null;
    const body = text.slice(end + HEADER_END.length);
    const marker = `问题：${header.question}\n\n`;
    const answerStart = body.indexOf(marker);
    const answer = (answerStart >= 0 ? body.slice(answerStart + marker.length) : body).trim();
    return {
      model: typeof header.model === 'string' ? header.model : '',
      requestId: typeof header.requestId === 'string' ? header.requestId : null,
      question: header.question,
      mode: header.mode as VisionMode,
      images: Array.isArray(header.images) ? header.images.filter((item): item is string => typeof item === 'string') : [],
      imageHashes:
        header.imageHashes && typeof header.imageHashes === 'object' && !Array.isArray(header.imageHashes)
          ? Object.fromEntries(
              Object.entries(header.imageHashes).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            )
          : {},
      at: typeof header.at === 'string' ? header.at : '',
      promptTokens: typeof header.promptTokens === 'number' ? header.promptTokens : null,
      completionTokens: typeof header.completionTokens === 'number' ? header.completionTokens : null,
      answer,
    };
  } catch {
    return null;
  }
}

/** 同图同问同模式才算命中（§3.2） */
export function sidecarMatches(
  record: SidecarRecord,
  args: LookAtImageArgs,
  imageHashes: Record<string, string>,
): boolean {
  if (record.mode !== args.mode) return false;
  if (record.question.trim() !== args.question.trim()) return false;
  const a = [...record.images].sort().join('\n');
  const b = [...args.paths].sort().join('\n');
  if (a !== b) return false;
  return args.paths.every((imagePath) => {
    const expected = imageHashes[imagePath];
    return typeof expected === 'string' && expected.length > 0 && record.imageHashes[imagePath] === expected;
  });
}

/** 各模式的提示词：看图回答不要长推理，读文字要逐字、不确定标 ? */
export function buildVisionPrompt(mode: VisionMode, question: string): string {
  switch (mode) {
    case 'describe':
      return `用中文描述这张（些）图片的内容：主体是什么、有哪些文字、值得注意的细节。只说图里有的，看不清的说看不清。用户的关注点：${question}`;
    case 'read_text':
      return [
        '逐字抄录图片里的所有文字，保持原有的行与分组；表格按行列出，每行一条，单元格之间用「｜」分隔。',
        '图纸类：先列标题栏字段（图号、名称、材料、比例、数量、日期等），再按位置列出尺寸标注与技术要求。',
        '认不清的字符写「?」，不要猜；没有文字就写「（图中没有文字）」。不要解释，不要总结。',
        `用户关注：${question}`,
      ].join('\n');
    default:
      return `只根据图片回答下面的问题，不要用图片以外的知识补充；看不清或图里没有就明确说。回答用中文，先给结论再给依据。\n问题：${question}`;
  }
}
