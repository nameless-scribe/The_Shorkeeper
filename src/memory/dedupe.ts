function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 仅用于无 memory_key 的自由文本写入：完全相同或互为子串 */
export function isDuplicateMemory(newContent: string, existing: string[]): boolean {
  const normalized = normalize(newContent);
  if (!normalized) return true;

  return existing.some((item) => {
    const other = normalize(item);
    if (!other) return false;
    return normalized === other || normalized.includes(other) || other.includes(normalized);
  });
}

/** 批内去重（同一次 LLM 输出内的完全重复） */
export function dedupeMemoryBatch(facts: string[]): string[] {
  const unique: string[] = [];
  for (const fact of facts) {
    if (!isDuplicateMemory(fact, unique)) {
      unique.push(fact);
    }
  }
  return unique;
}
