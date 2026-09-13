import { describe, expect, it } from 'vitest';
import { parseMessageCitations } from '../MessageContent';

describe('parseMessageCitations', () => {
  it('extracts stable memory and document refs while preserving surrounding text', () => {
    expect(parseMessageCitations('偏好拿铁〔mem:abc-1〕，依据文档〔doc:doc-2#chunk:3〕。')).toEqual([
      { type: 'text', value: '偏好拿铁' },
      { type: 'citation', ref: 'mem:abc-1' },
      { type: 'text', value: '，依据文档' },
      { type: 'citation', ref: 'doc:doc-2#chunk:3' },
      { type: 'text', value: '。' },
    ]);
  });

  it('leaves malformed refs as ordinary text', () => {
    expect(parseMessageCitations('不要解析〔doc:../../secret#chunk:0〕')).toEqual([
      { type: 'text', value: '不要解析〔doc:../../secret#chunk:0〕' },
    ]);
  });
});
