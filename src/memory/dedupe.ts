function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 简单字符串去重：完全相同或互为子串则视为重复 */
export function isDuplicateMemory(newContent: string, existing: string[]): boolean {
  const normalized = normalize(newContent);
  if (!normalized) return true;

  return existing.some((item) => {
    const other = normalize(item);
    if (!other) return false;
    return normalized === other || normalized.includes(other) || other.includes(normalized);
  });
}
