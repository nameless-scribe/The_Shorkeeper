import { describe, expect, it } from 'vitest';
import {
  buildVisionPrompt,
  estimateImageTokens,
  fitWithinLimits,
  formatSidecar,
  MAX_IMAGES_PER_CALL,
  parseLookAtImageArgs,
  parseSidecar,
  sidecarMatches,
  sidecarPathFor,
  type SidecarRecord,
} from '../contract';

describe('estimateImageTokens / fitWithinLimits', () => {
  it('follows the official formula and only shrinks images over the pixel cap', () => {
    expect(estimateImageTokens(1024, 1024)).toBe(1026);
    expect(estimateImageTokens(2048, 1536)).toBe(3074);
    expect(estimateImageTokens(4948, 7000)).toBe(33827);
    expect(fitWithinLimits(2048, 1536)).toEqual({ width: 2048, height: 1536, resized: false });
    expect(fitWithinLimits(4948, 7000)).toEqual({ width: 2545, height: 3600, resized: true });
    expect(fitWithinLimits(3600, 3600)).toEqual({ width: 3600, height: 3600, resized: false });
  });
});

describe('parseLookAtImageArgs', () => {
  it('normalises paths, requires a question and defaults the mode', () => {
    const parsed = parseLookAtImageArgs({ paths: ['照片\\a.JPG', '照片/a.JPG', 'b.png'], question: ' 这是什么 ' });
    expect(parsed).toEqual({ ok: true, value: { paths: ['照片/a.JPG', 'b.png'], question: '这是什么', mode: 'answer', refresh: false } });
    expect(parseLookAtImageArgs({ path: 'x.png', question: 'q', mode: 'read_text', refresh: true })).toMatchObject({ ok: true, value: { paths: ['x.png'], mode: 'read_text', refresh: true } });
  });

  it('rejects empty questions, unsupported files, too many images and bad modes', () => {
    expect(parseLookAtImageArgs({ paths: ['a.png'] })).toMatchObject({ ok: false, error: expect.stringContaining('question') });
    expect(parseLookAtImageArgs({ paths: ['a.pdf'], question: 'q' })).toMatchObject({ ok: false, error: expect.stringContaining('不是支持的图片') });
    expect(parseLookAtImageArgs({ paths: Array.from({ length: MAX_IMAGES_PER_CALL + 1 }, (_, i) => `${i}.png`), question: 'q' })).toMatchObject({ ok: false, error: expect.stringContaining('最多') });
    expect(parseLookAtImageArgs({ paths: ['a.png'], question: 'q', mode: 'ocr' })).toMatchObject({ ok: false, error: expect.stringContaining('mode') });
    expect(parseLookAtImageArgs({})).toMatchObject({ ok: false, error: expect.stringContaining('paths') });
  });
});

describe('sidecar', () => {
  const record: SidecarRecord = {
    model: 'qwen3-vl-plus',
    requestId: 'req-1',
    question: '这是什么设备？',
    mode: 'answer',
    images: ['照片/a.jpg'],
    imageHashes: { '照片/a.jpg': 'hash-a' },
    at: '2026-09-15T02:00:00.000Z',
    promptTokens: 1200,
    completionTokens: 80,
    answer: '这是一台立式加工中心。\n\n依据：…',
  };

  it('derives sidecar paths by mode and round-trips the header and answer', () => {
    expect(sidecarPathFor('照片/a.jpg', 'answer')).toBe('照片/a.vision.md');
    expect(sidecarPathFor('照片\\a.jpg', 'describe')).toBe('照片/a.vision.md');
    expect(sidecarPathFor('drawing.png', 'read_text')).toBe('drawing.ocr.md');
    expect(sidecarPathFor('no-ext', 'answer')).toBe('no-ext.vision.md');
    const text = formatSidecar(record);
    expect(text.startsWith('<!-- shorekeeper-vision')).toBe(true);
    expect(text).toContain('# 看图结果');
    expect(parseSidecar(text)).toEqual(record);
    expect(parseSidecar('# not a sidecar')).toBeNull();
  });

  it('matches only the same images, question and mode', () => {
    const hashes = { '照片/a.jpg': 'hash-a' };
    expect(sidecarMatches(record, { paths: ['照片/a.jpg'], question: '这是什么设备？', mode: 'answer', refresh: false }, hashes)).toBe(true);
    expect(sidecarMatches(record, { paths: ['照片/a.jpg'], question: '这是什么？', mode: 'answer', refresh: false }, hashes)).toBe(false);
    expect(sidecarMatches(record, { paths: ['照片/a.jpg'], question: '这是什么设备？', mode: 'describe', refresh: false }, hashes)).toBe(false);
    expect(sidecarMatches(record, { paths: ['照片/a.jpg', 'b.png'], question: '这是什么设备？', mode: 'answer', refresh: false }, hashes)).toBe(false);
    expect(sidecarMatches(record, { paths: ['照片/a.jpg'], question: '这是什么设备？', mode: 'answer', refresh: false }, { '照片/a.jpg': 'changed' })).toBe(false);
  });
});

describe('buildVisionPrompt', () => {
  it('keeps the question in every mode and asks for ? on unreadable characters when reading text', () => {
    expect(buildVisionPrompt('answer', '图号多少')).toContain('图号多少');
    expect(buildVisionPrompt('describe', '设备')).toContain('看不清的说看不清');
    const readText = buildVisionPrompt('read_text', '标题栏');
    expect(readText).toContain('「?」');
    expect(readText).toContain('标题栏字段');
  });
});
