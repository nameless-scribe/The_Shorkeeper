import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyWorkspaceFile, isWorkspaceImportableExtension, WORKSPACE_IMPORT_EXTENSIONS, WORKSPACE_PICK_DIALOG_FILTERS, workspaceFileToolHint, workspaceImportLimitBytes } from '../allowed-extensions';
import { formatAttachmentsForMessage } from '../import';
import { readFileTool } from '../../tools/file/read-file';

describe('image attachments (P8.1)', () => {
  it('classifies images separately from readable text and keeps them out of the text whitelist', () => {
    for (const ext of ['.jpg', '.JPEG', '.png', '.webp', '.bmp', '.gif']) {
      expect(classifyWorkspaceFile(ext)).toBe('image');
      expect(isWorkspaceImportableExtension(ext)).toBe(true);
      expect(WORKSPACE_IMPORT_EXTENSIONS.has(ext.toLowerCase())).toBe(false);
      expect(workspaceFileToolHint(ext)).toBe('look_at_image');
    }
    expect(workspaceImportLimitBytes('image')).toBe(20 * 1024 * 1024);
    expect(WORKSPACE_PICK_DIALOG_FILTERS.some((filter) => filter.name === '图片' && filter.extensions.includes('png'))).toBe(true);
  });

  it('introduces an image as something to look at, without skill trigger words', () => {
    const message = formatAttachmentsForMessage('这是什么', [{ relativePath: '照片.jpg', originalName: '照片.jpg', size: 1_200_000, kind: 'image' }]);
    expect(message).toContain('这是图片');
    expect(message).toContain('look_at_image');
    expect(message).toContain('不要用 read_file');
    expect(message).not.toMatch(/看看这张图|图片里|截图|图纸/);
    const inferred = formatAttachmentsForMessage('x', [{ relativePath: 'a.png', originalName: 'a.png', size: 10 }]);
    expect(inferred).toContain('look_at_image');
  });

  it('makes read_file refuse image files with a pointer to look_at_image', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-image-read-'));
    try {
      await fs.writeFile(path.join(workspace, 'a.png'), Buffer.from([0x89, 0x50]));
      const result = await readFileTool.execute({ path: 'a.png' }, { sessionId: 's', workspaceRoot: workspace, signal: new AbortController().signal });
      expect(result.success).toBe(false);
      expect(result.error).toContain('look_at_image');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
