export const CHUNK_SIZE = 512;
export const CHUNK_OVERLAP = 64;

export function splitTextIntoChunks(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const safeOverlap = Math.min(Math.max(0, overlap), chunkSize - 1);
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const slice = normalized.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= normalized.length) break;
    start = Math.max(0, end - safeOverlap);
    if (start >= normalized.length) break;
  }

  return chunks;
}

const CODE_PLACEHOLDER = '\x00CODE';

function protectCodeBlocks(text: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const protectedText = text.replace(/```[\s\S]*?```/g, (match) => {
    const index = blocks.length;
    blocks.push(match);
    return `${CODE_PLACEHOLDER}${index}\x00`;
  });
  return { text: protectedText, blocks };
}

function restoreCodeBlocks(text: string, blocks: string[]): string {
  return text.replace(
    new RegExp(`${CODE_PLACEHOLDER}(\\d+)\\x00`, 'g'),
    (_, index) => blocks[Number(index)] ?? '',
  );
}

/** Markdown-aware chunking: split on headings, preserve fenced code blocks */
export function splitMarkdownIntoChunks(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const { text: protectedText, blocks } = protectCodeBlocks(normalized);
  const sections = protectedText.split(/\n(?=#{1,3}\s)/);
  const chunks: string[] = [];

  for (let section of sections) {
    section = restoreCodeBlocks(section, blocks).trim();
    if (!section) continue;
    if (section.length <= chunkSize) {
      chunks.push(section);
    } else {
      chunks.push(...splitTextIntoChunks(section, chunkSize, overlap));
    }
  }

  return chunks;
}

export function splitIntoChunks(text: string, filename?: string): string[] {
  const isMarkdown =
    filename?.toLowerCase().endsWith('.md') || /^#{1,3}\s/m.test(text);
  if (isMarkdown) {
    return splitMarkdownIntoChunks(text);
  }
  return splitTextIntoChunks(text);
}
