import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../registry';
import { readFileTool } from '../file/read-file';
import { writeFileTool } from '../file/write-file';
import { listDirTool } from '../file/list-dir';
import { webSearchTool } from '../web/web-search';
import { fetchUrlTool, isPublicAddress, readLimitedBody } from '../web/fetch-url';
import { translateTool } from '../web/translate';
import { genDocxTool, genMarkdownTool, genXlsxTool, readXlsxTool } from '../doc/gen-tools';
import { loadExcelJS } from '../doc/exceljs-loader';
import { convertToMarkdownTool } from '../doc/convert-markdown';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';

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
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WEB_SEARCH_API_KEY;
    delete process.env.BOCHA_API_KEY;
  });

  it('returns output for a query when bocha key is configured', async () => {
    process.env.WEB_SEARCH_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: {
              webPages: {
                value: [
                  {
                    name: 'TypeScript 新闻',
                    url: 'https://example.com/ts',
                    snippet: 'A typed superset of JavaScript.',
                    siteName: 'Example',
                  },
                ],
              },
            },
          }),
      }),
    );

    const result = await webSearchTool.execute(
      { query: 'TypeScript' },
      { sessionId: 's1', workspaceRoot: os.tmpdir(), signal: new AbortController().signal },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('TypeScript');
  });

  it('reports missing api key', async () => {
    const result = await webSearchTool.execute(
      { query: '热搜' },
      { sessionId: 's1', workspaceRoot: os.tmpdir(), signal: new AbortController().signal },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('未配置联网搜索 API Key');
  });
});

describe('write_file', () => {
  it('writes file within workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-write-'));

    const result = await writeFileTool.execute(
      { path: 'out/note.txt', content: 'hello' },
      { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal },
    );

    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(root, 'out', 'note.txt'), 'utf-8');
    expect(content).toBe('hello');
  });
});

describe('fetch_url', () => {
  it('rejects private and mapped loopback addresses before connecting', async () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('127.0.0.1')).toBe(false);
    expect(isPublicAddress('169.254.169.254')).toBe(false);
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false);
    const result = await fetchUrlTool.execute(
      { url: 'http://127.0.0.1/private' },
      { sessionId: 's1', workspaceRoot: os.tmpdir(), signal: new AbortController().signal },
    );
    expect(result).toMatchObject({
      success: false,
      error: '不允许访问本地或私有网络地址',
    });
  });

  it('stops reading once the byte cap is reached', async () => {
    const response = Readable.from([
      Buffer.alloc(40_000, 'a'),
      Buffer.alloc(40_000, 'b'),
    ]) as IncomingMessage;
    const result = await readLimitedBody(response, 64_000);
    expect(result.truncated).toBe(true);
    expect(result.body).toHaveLength(64_000);
  });
});

describe('translate', () => {
  it('returns translated text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          responseStatus: 200,
          responseData: { translatedText: '你好' },
        }),
      }),
    );

    const result = await translateTool.execute(
      { text: 'hello', target_lang: 'zh-CN' },
      { sessionId: 's1', workspaceRoot: os.tmpdir(), signal: new AbortController().signal },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('你好');
    vi.unstubAllGlobals();
  });
});

describe('gen_markdown', () => {
  it('creates markdown file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-md-'));

    const result = await genMarkdownTool.execute(
      { path: 'doc.md', content: '# Title' },
      { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal },
    );

    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(root, 'doc.md'), 'utf-8');
    expect(content).toBe('# Title');
  });
});

describe('read_xlsx / gen_xlsx', () => {
  beforeAll(async () => {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('warmup');
    await wb.xlsx.writeBuffer();
  }, 30_000);

  it('round-trips xlsx via read and gen', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-xlsx-'));
    const ctx = { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal };

    const gen = await genXlsxTool.execute(
      {
        path: 'data/sales.xlsx',
        sheet_name: 'Q1',
        headers: ['产品', '数量'],
        rows: [['键盘', '10'], ['鼠标', '20']],
      },
      ctx,
    );
    expect(gen.success).toBe(true);
    expect(gen.artifacts?.[0]?.relativePath).toBe('data/sales.xlsx');

    const read = await readXlsxTool.execute({ path: 'data/sales.xlsx' }, ctx);
    expect(read.success).toBe(true);
    const parsed = JSON.parse(read.output) as {
      sheet: string;
      headers: string[];
      rows: string[][];
    };
    expect(parsed.sheet).toBe('Q1');
    expect(parsed.headers).toEqual(['产品', '数量']);
    expect(parsed.rows).toEqual([['键盘', '10'], ['鼠标', '20']]);
  });
});

describe('convert_to_markdown', () => {
  it('converts txt to markdown file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-conv-'));
    const ctx = { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal };

    await fs.writeFile(path.join(root, 'note.txt'), '第一段\n\n第二段', 'utf-8');

    const result = await convertToMarkdownTool.execute({ source_path: 'note.txt' }, ctx);
    expect(result.success).toBe(true);
    expect(result.artifacts?.[0]?.relativePath).toBe('note.md');

    const md = await fs.readFile(path.join(root, 'note.md'), 'utf-8');
    expect(md).toContain('# note');
    expect(md).toContain('第一段');
    expect(md).toContain('第二段');
  });

  it(
    'converts docx to markdown file',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-conv-docx-'));
      const ctx = { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal };

      const gen = await genDocxTool.execute(
        { path: 'draft.docx', title: '测试标题', body: '正文段落一\n\n正文段落二' },
        ctx,
      );
      expect(gen.success).toBe(true);

      const result = await convertToMarkdownTool.execute({ source_path: 'draft.docx' }, ctx);
      expect(result.success).toBe(true);

      const md = await fs.readFile(path.join(root, 'draft.md'), 'utf-8');
      expect(md.length).toBeGreaterThan(10);
      expect(md).toMatch(/正文段落/);
    },
    15_000,
  );
});
