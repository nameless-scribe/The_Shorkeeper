import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const HIGH_LEVEL_DIRECTORIES = [
  'agent',
  'memory',
  'rag',
  'renderer',
  'scheduler',
  'tools',
];
const MEMORY_DOMAIN_FILES = ['long-term.ts', 'reembed-queue.ts'];
const WORLDBOOK_DOMAIN_FILE = 'worldbook.ts';
const RAG_DOMAIN_FILE = 'documents.ts';

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(fullPath);
    }
    return /\.tsx?$/.test(entry.name) ? [fullPath] : [];
  });
}

describe('database access boundaries', () => {
  it('keeps high-level application layers behind database modules', () => {
    const violations: string[] = [];
    for (const directory of HIGH_LEVEL_DIRECTORIES) {
      const root = path.join(process.cwd(), 'src', directory);
      for (const file of sourceFiles(root)) {
        const source = fs.readFileSync(file, 'utf8');
        if (/import\s*\{[^}]*\bgetDatabase\b[^}]*\}\s*from/.test(source)) {
          violations.push(path.relative(process.cwd(), file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps long-term memory domain logic behind its repository', () => {
    const violations = MEMORY_DOMAIN_FILES.filter((filename) => {
      const source = fs.readFileSync(path.join(process.cwd(), 'src', 'memory', filename), 'utf8');
      return /\bgetDatabase\b|\.prepare\s*\(|\blong_term_memory\b/.test(source);
    });
    expect(violations).toEqual([]);
  });

  it('keeps worldbook database access behind its repository', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'memory', WORLDBOOK_DOMAIN_FILE),
      'utf8',
    );
    expect(/\bgetDatabase\b|\.prepare\s*\(|\bworldbook_fts\b/.test(source)).toBe(false);
  });

  it('keeps RAG document database access behind its repository', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'rag', RAG_DOMAIN_FILE),
      'utf8',
    );
    expect(/\bgetDatabase\b|\.prepare\s*\(|\.transaction\s*\(/.test(source)).toBe(false);
  });
});
