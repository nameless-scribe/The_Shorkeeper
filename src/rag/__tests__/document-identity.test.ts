import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveDocumentTitle,
  normalizeDocumentSourcePath,
  normalizeDocumentTitle,
} from '../document-identity';

describe('document identity', () => {
  it('prefers an explicit title, then a Markdown heading, then the filename', () => {
    expect(deriveDocumentTitle('# Heading\n\nBody', 'fallback.md', ' Explicit ')).toBe('Explicit');
    expect(deriveDocumentTitle('# Heading\n\nBody', 'fallback.md')).toBe('Heading');
    expect(deriveDocumentTitle('plain body', 'fallback.txt')).toBe('fallback');
  });

  it('normalizes title whitespace and compatibility characters', () => {
    expect(normalizeDocumentTitle('  ＡＢＣ   Project  ')).toBe('abc project');
  });

  it('normalizes source paths for stable path identity', () => {
    const source = path.join(process.cwd(), 'Docs', '..', 'Docs', 'Guide.md');
    const expected = path.resolve(source).replace(/\\/g, '/');
    expect(normalizeDocumentSourcePath(source)).toBe(
      process.platform === 'win32' ? expected.toLocaleLowerCase() : expected,
    );
  });
});
