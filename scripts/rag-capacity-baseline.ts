import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openNativeDatabase } from '../src/db/native-adapter';
import {
  insertDocumentWithChunks,
  loadAllChunkEmbeddingRecords,
  searchDocumentChunkFtsRanks,
} from '../src/db/repositories/rag-documents';
import { cosineSimilarity, deserializeEmbedding, serializeEmbedding } from '../src/rag/vector';

interface CapacityTier {
  name: string;
  documents: number;
  chunksPerDocument: number;
  embeddingDimension: number;
}

const TIERS: CapacityTier[] = [
  { name: 'small', documents: 50, chunksPerDocument: 20, embeddingDimension: 256 },
  { name: 'medium', documents: 250, chunksPerDocument: 20, embeddingDimension: 256 },
  { name: 'reference', documents: 500, chunksPerDocument: 20, embeddingDimension: 256 },
];

function elapsed(start: number): number {
  return Number((performance.now() - start).toFixed(1));
}

function mib(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function createVector(dimension: number, seed: number): Uint8Array {
  const vector = new Float32Array(dimension);
  for (let index = 0; index < dimension; index += 1) {
    vector[index] = ((seed + index * 17) % 101) / 100;
  }
  return serializeEmbedding(Array.from(vector));
}

function runTier(tier: CapacityTier) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `shorekeeper-rag-${tier.name}-`));
  const dbPath = path.join(root, 'capacity.db');
  const memoryBefore = process.memoryUsage();
  const openedAt = performance.now();
  const db = openNativeDatabase(dbPath);
  const openMs = elapsed(openedAt);

  try {
    const insertStarted = performance.now();
    for (let docIndex = 0; docIndex < tier.documents; docIndex += 1) {
      const chunks = Array.from({ length: tier.chunksPerDocument }, (_, chunkIndex) => {
        const marker = `anchor${docIndex % 25}`;
        const content = `${marker} document ${docIndex} chunk ${chunkIndex} 守岸人容量基线内容`;
        return {
          content,
          ftsText: content,
          embedding: createVector(tier.embeddingDimension, docIndex + chunkIndex),
        };
      });
      insertDocumentWithChunks({
        filename: `capacity-${docIndex}.md`,
        filepath: `knowledge/capacity-${docIndex}.md`,
        mimeType: 'text/markdown',
        chunks,
        embeddingModel: 'capacity-baseline',
        embeddingDim: tier.embeddingDimension,
        status: 'indexed',
      }, db);
    }
    const insertMs = elapsed(insertStarted);

    const loadStarted = performance.now();
    const stored = loadAllChunkEmbeddingRecords(db).map((row) => ({
      ...row,
      embedding: deserializeEmbedding(row.embedding),
    }));
    const vectorLoadMs = elapsed(loadStarted);

    const query = new Float32Array(tier.embeddingDimension);
    query.fill(0.5);
    const scanStarted = performance.now();
    const top = stored
      .map((row) => ({ id: row.id, score: cosineSimilarity(query, row.embedding) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 20);
    const vectorScanMs = elapsed(scanStarted);

    const ftsStarted = performance.now();
    const fts = searchDocumentChunkFtsRanks('"anchor1"', 20, undefined, db) ?? [];
    const ftsMs = elapsed(ftsStarted);

    db.checkpoint('TRUNCATE');
    const memoryAfter = process.memoryUsage();
    return {
      tier: tier.name,
      documents: tier.documents,
      chunks: stored.length,
      embeddingDimension: tier.embeddingDimension,
      openMs,
      insertMs,
      vectorLoadMs,
      vectorScanMs,
      ftsMs,
      vectorHits: top.length,
      ftsHits: fts.length,
      databaseMiB: mib(fs.statSync(dbPath).size),
      heapDeltaMiB: mib(Math.max(0, memoryAfter.heapUsed - memoryBefore.heapUsed)),
      rssDeltaMiB: mib(Math.max(0, memoryAfter.rss - memoryBefore.rss)),
    };
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  },
  note: 'reference 档是当前稳定化参考规模，不代表硬性产品上限；内存增量受进程和 GC 状态影响。',
  tiers: TIERS.map(runTier),
}, null, 2));
