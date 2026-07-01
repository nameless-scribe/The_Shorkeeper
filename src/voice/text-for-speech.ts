/** Strip markdown / tool noise before TTS. */
export function stripMarkdownForSpeech(text: string): string {
  let s = text.trim();
  if (!s) return '';

  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`[^`]+`/g, ' ');
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/_{1,2}([^_]+)_{1,2}/g, '$1');
  s = s.replace(/\|/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

export function truncateForSpeech(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}
