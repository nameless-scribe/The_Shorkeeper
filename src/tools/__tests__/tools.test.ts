import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../registry';
import { readFileTool } from '../file/read-file';
import { listDirTool } from '../file/list-dir';
import { webSearchTool } from '../web/web-search';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(listDirTool);

    expect(registry.list()).toHaveLength(2);
    expect(registry.get('read_file')?.name).toBe('read_file');
  });

  it('converts to OpenAI tool schemas', () => {
    const registry = new ToolRegistry();
    registry.register(listDirTool);
    const schemas = registry.toOpenAITools();

    expect(schemas[0].type).toBe('function');
    expect(schemas[0].function.name).toBe('list_dir');
    expect(schemas[0].function.parameters.type).toBe('object');
  });

  it('rejects duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    expect(() => registry.register(readFileTool)).toThrow(/already registered/);
  });
});

describe('read_file', () => {
  it('reads file within workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-read-'));
    await fs.writeFile(path.join(root, 'hello.txt'), '你好', 'utf-8');

    const result = await readFileTool.execute(
      { path: 'hello.txt' },
      { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('你好');
  });

  it('rejects path outside workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-read-'));

    const result = await readFileTool.execute(
      { path: '../../etc/passwd' },
      { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/越界/);
  });
});

describe('list_dir', () => {
  it('lists workspace directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-list-'));
    await fs.writeFile(path.join(root, 'a.txt'), '', 'utf-8');
    await fs.mkdir(path.join(root, 'subdir'));

    const result = await listDirTool.execute(
      { path: '.' },
      { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('file\ta.txt');
    expect(result.output).toContain('dir\tsubdir');
  });
});

describe('web_search', () => {
  it('returns output for a query', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Heading: 'TypeScript',
          AbstractText: 'A typed superset of JavaScript.',
          AbstractURL: 'https://example.com',
        }),
      }),
    );

    const result = await webSearchTool.execute(
      { query: 'TypeScript' },
      { sessionId: 's1', workspaceRoot: os.tmpdir(), signal: new AbortController().signal },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('TypeScript');
    vi.unstubAllGlobals();
  });
});
