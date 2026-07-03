export function buildChunkEmbedText(
  filename: string,
  sectionTitle: string | undefined,
  content: string,
): string {
  const header = sectionTitle ? `[${filename} > ${sectionTitle}]` : `[${filename}]`;
  return `${header}\n\n${content}`;
}
