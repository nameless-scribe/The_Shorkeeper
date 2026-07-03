import { buildChunkEmbedText } from './chunk-prefix';

export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 64;

export interface TextChunk {
  content: string;
  sectionTitle?: string;
  embedText: string;
}

export function splitTextIntoChunks(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
  filename = '',
  sectionTitle?: string,
): TextChunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const safeOverlap = Math.min(Math.max(0, overlap), chunkSize - 1);
  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const slice = normalized.slice(start, end).trim();
    if (slice) {
      chunks.push({
        content: slice,
        sectionTitle,
        embedText: buildChunkEmbedText(filename, sectionTitle, slice),
      });
    }
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

function extractSectionTitle(section: string): string | undefined {
  const match = section.match(/^#{1,3}\s+(.+?)(?:\n|$)/);
  return match?.[1]?.trim();
}

/** Markdown-aware chunking: split on headings, preserve fenced code blocks */
export function splitMarkdownIntoChunks(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
  filename = '',
): TextChunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const { text: protectedText, blocks } = protectCodeBlocks(normalized);
  const sections = protectedText.split(/\n(?=#{1,3}\s)/);
  const chunks: TextChunk[] = [];

  for (let section of sections) {
    section = restoreCodeBlocks(section, blocks).trim();
    if (!section) continue;
    const sectionTitle = extractSectionTitle(section);
    if (section.length <= chunkSize) {
      chunks.push({
        content: section,
        sectionTitle,
        embedText: buildChunkEmbedText(filename, sectionTitle, section),
      });
    } else {
      chunks.push(...splitTextIntoChunks(section, chunkSize, overlap, filename, sectionTitle));
    }
  }

  return chunks;
}

export function splitIntoChunks(text: string, filename?: string): TextChunk[] {
  const name = filename ?? '';
  const isMarkdown =
    filename?.toLowerCase().endsWith('.md') || /^#{1,3}\s/m.test(text);
  if (isMarkdown) {
    return splitMarkdownIntoChunks(text, CHUNK_SIZE, CHUNK_OVERLAP, name);
  }
  return splitTextIntoChunks(text, CHUNK_SIZE, CHUNK_OVERLAP, name);
}

/** @deprecated use TextChunk.content */
export function splitIntoChunkStrings(text: string, filename?: string): string[] {
  return splitIntoChunks(text, filename).map((c) => c.content);
}
