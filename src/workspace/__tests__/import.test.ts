import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyWorkspaceFile,
  MAX_WORKSPACE_AUDIO_IMPORT_BYTES,
  MAX_WORKSPACE_IMPORT_BYTES,
  WORKSPACE_AUDIO_EXTENSIONS,
  WORKSPACE_IMPORT_EXTENSIONS,
  workspaceFileToolHint,
} from '../allowed-extensions';
import { importFileToWorkspace, recoverWorkspaceImportTemps } from '../import';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let tempDir: string;
let workspaceDir: string;
let sourceDir: string;

beforeEach(async () => {
  tempDir = path.join(os.tmpdir(), `sk-import-test-${Date.now()}-${Math.random()}`);
  workspaceDir = path.join(tempDir, 'workspace');
  sourceDir = path.join(tempDir, 'sources');
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(sourceDir, { recursive: true });
  process.env.SHOREKEEPER_WORKSPACE_DIR = workspaceDir;
});

afterEach(async () => {
  delete process.env.SHOREKEEPER_WORKSPACE_DIR;
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('workspace import extensions', () => {
  it('allows office formats', () => {
    expect(WORKSPACE_IMPORT_EXTENSIONS.has('.docx')).toBe(true);
    expect(WORKSPACE_IMPORT_EXTENSIONS.has('.xlsx')).toBe(true);
  });

  it('accepts PDF as an office attachment that must go through convert_to_markdown', () => {
    // P5.0：PDF 是二进制，不能让模型 read_file 直接读；分类为 office 并提示转换工具
    expect(WORKSPACE_IMPORT_EXTENSIONS.has('.pdf')).toBe(true);
    expect(classifyWorkspaceFile('.PDF')).toBe('office');
    expect(workspaceFileToolHint('.pdf')).toBe('convert_to_markdown');
  });

  it('imports xlsx into workspace', async () => {
    const source = path.join(sourceDir, 'sample.xlsx');
    await fs.writeFile(source, 'fake-xlsx', 'utf-8');

    const result = await importFileToWorkspace(source);
    expect(result.originalName).toBe('sample.xlsx');
    expect(result.relativePath).toBe('sample.xlsx');
    expect(workspaceFileToolHint('.xlsx')).toBe('read_xlsx');
    await expect(fs.readFile(source, 'utf-8')).resolves.toBe('fake-xlsx');
  });

  it('renames duplicate imports with _N suffix', async () => {
    const source = path.join(sourceDir, 'sample.xlsx');
    await fs.writeFile(source, 'fake-xlsx', 'utf-8');

    const first = await importFileToWorkspace(source);
    expect(first.relativePath).toBe('sample.xlsx');

    const second = await importFileToWorkspace(source);
    expect(second.relativePath).toBe('sample_1.xlsx');
    expect(second.originalName).toBe('sample.xlsx');
  });

  it('allocates unique complete files for concurrent imports with the same name', async () => {
    const source = path.join(sourceDir, 'concurrent.md');
    const content = '# Concurrent import\n\n每个并发导入都必须完整。';
    await fs.writeFile(source, content, 'utf-8');

    const results = await Promise.all([
      importFileToWorkspace(source),
      importFileToWorkspace(source),
      importFileToWorkspace(source),
    ]);

    expect(results.map((result) => result.relativePath).sort()).toEqual([
      'concurrent.md',
      'concurrent_1.md',
      'concurrent_2.md',
    ]);
    await Promise.all(results.map(async (result) => {
      await expect(fs.readFile(path.join(workspaceDir, result.relativePath), 'utf8'))
        .resolves.toBe(content);
    }));
    expect((await fs.readdir(workspaceDir)).some((name) => name.startsWith('.shorekeeper-import-')))
      .toBe(false);
  });

  it('keeps audio out of the document whitelist but classifies and hints it separately', () => {
    // 录音白名单来自转写契约，不并入文档白名单：两者的上下文处理与上限都不同
    expect(WORKSPACE_AUDIO_EXTENSIONS.has('.m4a')).toBe(true);
    expect(WORKSPACE_IMPORT_EXTENSIONS.has('.m4a')).toBe(false);
    expect(classifyWorkspaceFile('.M4A')).toBe('audio');
    expect(classifyWorkspaceFile('.docx')).toBe('office');
    expect(classifyWorkspaceFile('.md')).toBe('text');
    expect(workspaceFileToolHint('.wav')).toBe('transcribe_audio');
    expect(MAX_WORKSPACE_AUDIO_IMPORT_BYTES).toBeGreaterThan(MAX_WORKSPACE_IMPORT_BYTES);
  });

  it('imports audio above the 20MB document limit and tags it as audio', async () => {
    const source = path.join(sourceDir, '周会.m4a');
    await fs.writeFile(source, Buffer.alloc(MAX_WORKSPACE_IMPORT_BYTES + 1, 7));

    const result = await importFileToWorkspace(source);
    expect(result).toMatchObject({ relativePath: '周会.m4a', originalName: '周会.m4a', kind: 'audio' });
    expect(result.size).toBe(MAX_WORKSPACE_IMPORT_BYTES + 1);
  });

  it('rejects a source that grows beyond the import limit while being read', async () => {
    const source = path.join(sourceDir, 'too-large.md');
    const limit = 20 * 1024 * 1024;
    await fs.writeFile(source, Buffer.alloc(limit + 1, 1));

    await expect(importFileToWorkspace(source)).rejects.toThrow('文件超过 20MB 上限');
    expect(await fs.readdir(workspaceDir)).toEqual([]);
  });

  it('cleans only managed import temporary files during startup recovery', async () => {
    await fs.writeFile(path.join(workspaceDir, '.shorekeeper-import-crash.tmp'), 'partial');
    await fs.writeFile(path.join(workspaceDir, 'user-file.tmp'), 'keep');
    await fs.mkdir(path.join(workspaceDir, '.shorekeeper-import-directory.tmp'));

    await expect(recoverWorkspaceImportTemps()).resolves.toEqual({
      cleaned: 1,
      retained: 1,
    });
    expect((await fs.readdir(workspaceDir)).sort()).toEqual([
      '.shorekeeper-import-directory.tmp',
      'user-file.tmp',
    ]);
  });
});
