import { describe, expect, it } from 'vitest';
import { DeltaSentenceBuffer } from '../delta-sentence-buffer';

describe('DeltaSentenceBuffer', () => {
  it('emits complete sentences on boundary', () => {
    const buf = new DeltaSentenceBuffer();
    expect(buf.append('你好。')).toEqual(['你好。']);
    expect(buf.append('世界！')).toEqual(['世界！']);
  });

  it('strips parenthetical actions from emitted sentences', () => {
    const buf = new DeltaSentenceBuffer();
    const ready = buf.append('（侧头）欢迎回来。');
    expect(ready).toEqual(['欢迎回来。']);
  });

  it('buffers incomplete sentences until boundary', () => {
    const buf = new DeltaSentenceBuffer();
    expect(buf.append('你好')).toEqual([]);
    expect(buf.append('世界。')).toEqual(['你好世界。']);
  });

  it('flush emits trailing text', () => {
    const buf = new DeltaSentenceBuffer();
    expect(buf.append('未完')).toEqual([]);
    expect(buf.flush()).toEqual(['未完']);
  });
});
