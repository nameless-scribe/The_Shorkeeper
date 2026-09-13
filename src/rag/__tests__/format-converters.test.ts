import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getText, destroy } = vi.hoisted(() => ({
  getText: vi.fn<() => Promise<{ text: string }>>(),
  destroy: vi.fn<() => Promise<void>>(),
}));

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    getText = getText;
    destroy = destroy;
  },
}));

import { convertPdfToMarkdown } from '../format-converters';

const temporaryFiles: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(temporaryFiles.splice(0).map((file) => fs.unlink(file).catch(() => undefined)));
});

async function fakePdf(): Promise<string> {
  const file = path.join(os.tmpdir(), `shorekeeper-pdf-${Date.now()}-${Math.random()}.pdf`);
  await fs.writeFile(file, 'fake pdf');
  temporaryFiles.push(file);
  return file;
}

describe('PDF converter resource lifecycle', () => {
  it('destroys the parser after successful extraction', async () => {
    getText.mockResolvedValue({ text: '解析成功' });
    destroy.mockResolvedValue();

    await expect(convertPdfToMarkdown(await fakePdf(), '测试'))
      .resolves.toContain('解析成功');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('destroys the parser when extraction fails', async () => {
    getText.mockRejectedValue(new Error('corrupt stream'));
    destroy.mockResolvedValue();

    await expect(convertPdfToMarkdown(await fakePdf(), '损坏'))
      .rejects.toThrow('PDF 文本提取失败：corrupt stream');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
