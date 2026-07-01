/** Reciprocal Rank Fusion: merges dense and sparse retrieval rankings */
export function reciprocalRankFusion(
  denseRanks: Map<string, number>,
  sparseRanks: Map<string, number>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  const allIds = new Set([...denseRanks.keys(), ...sparseRanks.keys()]);

  for (const id of allIds) {
    let score = 0;
    const denseRank = denseRanks.get(id);
    const sparseRank = sparseRanks.get(id);
    if (denseRank != null) score += 1 / (k + denseRank);
    if (sparseRank != null) score += 1 / (k + sparseRank);
    scores.set(id, score);
  }

  return scores;
}

export function ranksFromOrderedIds(ids: string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  ids.forEach((id, index) => ranks.set(id, index + 1));
  return ranks;
}
