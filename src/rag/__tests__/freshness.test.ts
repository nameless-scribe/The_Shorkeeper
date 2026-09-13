import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentInfo } from '../documents';

const state: { document: DocumentInfo } = { document: {} as DocumentInfo };
const importDocumentFromPath = vi.fn();

vi.mock('../documents', () => ({
  getDocument: vi.fn(() => state.document),
  listDocuments: vi.fn(() => [state.document]),
  updateDocumentMeta: vi.fn((_id: string, patch: Partial<DocumentInfo>) => {
    state.document = { ...state.document, ...patch, updatedAt: Date.now() };
  }),
}));
vi.mock('../importer', () => ({ importDocumentFromPath: (...args: unknown[]) => importDocumentFromPath(...args) }));

import { checkDocumentFreshness, syncDocumentSource } from '../freshness';

let dir: string;
let sourcePath: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-freshness-'));
  sourcePath = path.join(dir, 'source.md');
  fs.writeFileSync(sourcePath, 'old');
  const stat = fs.statSync(sourcePath);
  state.document = {
    id: 'doc-1', filename: 'source.md', filepath: 'knowledge/source.md', mimeType: 'text/markdown',
    chunkCount: 1, importedAt: 1, status: 'indexed', statusError: null, updatedAt: 1,
    indexedAt: 1, deletedAt: null, sourcePath, title: 'source', titleKey: 'source', version: 1,
    supersededBy: null, chunkSize: 800, chunkOverlap: 64, sourceKind: 'local_file',
    sourceModifiedAt: Math.floor(stat.mtimeMs), sourceSize: stat.size, lastCheckedAt: null,
    freshnessStatus: 'unknown', staleReason: null, syncPolicy: 'manual',
  };
  importDocumentFromPath.mockReset();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('document freshness', () => {
  it('marks current, changed and missing without discarding the indexed snapshot', async () => {
    expect((await checkDocumentFreshness('doc-1')).freshnessStatus).toBe('current');
    fs.appendFileSync(sourcePath, ' changed');
    expect((await checkDocumentFreshness('doc-1')).freshnessStatus).toBe('changed');
    expect(state.document.status).toBe('indexed');
    fs.unlinkSync(sourcePath);
    expect((await checkDocumentFreshness('doc-1')).freshnessStatus).toBe('missing');
    expect(state.document.chunkCount).toBe(1);
  });

  it('does not create a version for an unchanged source, but imports an explicitly stale source', async () => {
    await syncDocumentSource('doc-1');
    expect(importDocumentFromPath).not.toHaveBeenCalled();
    state.document.freshnessStatus = 'changed';
    const next = { ...state.document, id: 'doc-2', version: 2, freshnessStatus: 'current' as const };
    importDocumentFromPath.mockResolvedValue(next);
    expect(await syncDocumentSource('doc-1')).toEqual(next);
    expect(importDocumentFromPath).toHaveBeenCalledWith(sourcePath, undefined, expect.objectContaining({ skipHashDedup: true }));
  });
});
