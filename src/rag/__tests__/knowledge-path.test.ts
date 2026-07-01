import { describe, expect, it } from 'vitest';
import { sanitizeKnowledgeFilename } from '../knowledge-path';

describe('sanitizeKnowledgeFilename', () => {
  it('rejects path traversal', () => {
    expect(() => sanitizeKnowledgeFilename('../../outside.md')).toThrow();
    expect(() => sanitizeKnowledgeFilename('../secret.md')).toThrow();
  });

  it('strips directory components', () => {
    expect(sanitizeKnowledgeFilename('subdir/notes.md')).toBe('notes.md');
  });

  it('sanitizes illegal characters', () => {
    expect(sanitizeKnowledgeFilename('bad<file>.md')).toBe('bad_file_.md');
  });
});
