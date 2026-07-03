export interface DocumentSummary {
  summary: string;
  outline: string;
}

const SUMMARY_MAX_LEN = 120;

function extractFirstParagraph(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const parts: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (parts.length) break;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed)) continue;
    parts.push(trimmed);
    if (parts.join(' ').length >= SUMMARY_MAX_LEN) break;
  }
  return parts.join(' ').slice(0, SUMMARY_MAX_LEN);
}

function extractHeadings(text: string): string[] {
  const headings: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      headings.push(match[2].trim());
    }
  }
  return headings;
}

function extractTopLevelTitle(text: string): string | null {
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

export function generateDocumentSummary(text: string, filename: string): DocumentSummary {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const firstPara = extractFirstParagraph(normalized);
  const topTitle = extractTopLevelTitle(normalized);
  const headings = extractHeadings(normalized);

  const parts: string[] = [];
  if (topTitle) parts.push(topTitle);
  if (firstPara && firstPara !== topTitle) parts.push(firstPara);
  if (!parts.length) {
    const base = filename.replace(/\.[^.]+$/, '');
    parts.push(base);
  }

  const summary = parts.join('；').slice(0, SUMMARY_MAX_LEN);
  const outline = JSON.stringify(headings.slice(0, 30));

  return { summary, outline };
}
