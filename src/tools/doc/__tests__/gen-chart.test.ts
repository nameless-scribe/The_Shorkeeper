import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { genChartTool } from '../gen-chart';
import { rasterizeSvgToPng } from '../../../documents/svg-raster';
import { renderChartSvg } from '../../../documents/chart-svg';
import { MAX_PREVIEW_IMAGE_BYTES, readWorkspaceImageDataUrl } from '../../../workspace/image-preview';

function context(root: string) {
  return { sessionId: 's1', workspaceRoot: root, signal: new AbortController().signal };
}

async function workspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sk-chart-'));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('gen_chart', () => {
  it('rejects missing arguments, non-svg paths and bad specs without writing anything', async () => {
    const root = await workspace();
    const missing = await genChartTool.execute({ path: 'a.svg' }, context(root));
    expect(missing.success).toBe(false);
    expect(missing.errorCategory).toBe('invalid_arguments');

    const wrongSuffix = await genChartTool.execute(
      { path: 'a.png', type: 'bar', title: 't', labels: ['a'], series: [{ name: '', values: [1] }] },
      context(root),
    );
    expect(wrongSuffix.success).toBe(false);
    expect(wrongSuffix.error).toContain('.svg');

    const mismatched = await genChartTool.execute(
      { path: 'a.svg', type: 'line', title: 't', labels: ['a', 'b'], series: [{ name: '', values: [1] }] },
      context(root),
    );
    expect(mismatched.success).toBe(false);
    expect(mismatched.errorCategory).toBe('invalid_arguments');

    const multiPie = await genChartTool.execute(
      {
        path: 'a.svg',
        type: 'pie',
        title: 't',
        labels: ['a'],
        series: [
          { name: 'x', values: [1] },
          { name: 'y', values: [2] },
        ],
      },
      context(root),
    );
    expect(multiPie.success).toBe(false);

    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('writes the svg and a same-named png and reports both artifacts', async () => {
    const root = await workspace();
    const result = await genChartTool.execute(
      {
        path: 'charts/月销售额.svg',
        type: 'bar',
        title: '上半年销售额',
        labels: ['1 月', '2 月', '3 月'],
        series: [
          { name: '华东', values: [120, 98.5, 143] },
          { name: '华北', values: [80, 110, 95] },
        ],
        source: 'sales.xlsx 工作表 1 A2:C4',
      },
      context(root),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('charts/月销售额.svg');
    expect(result.output).toContain('charts/月销售额.png');
    expect(result.output).toContain('2 个系列');
    expect(result.output).not.toContain('PNG 未生成');
    expect(result.metadata).toMatchObject({ type: 'bar', categories: 3, series: 2, png: true });
    expect(result.artifacts?.map((artifact) => artifact.relativePath)).toEqual([
      'charts/月销售额.svg',
      'charts/月销售额.png',
    ]);

    const svg = await fs.readFile(path.join(root, 'charts/月销售额.svg'), 'utf-8');
    expect(svg).toContain('<title>上半年销售额</title>');
    expect(svg).toContain('<desc>来源：sales.xlsx 工作表 1 A2:C4</desc>');

    const png = await fs.readFile(path.join(root, 'charts/月销售额.png'));
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // 2 倍缩放：IHDR 的宽高应是 SVG 画布的两倍
    expect(png.readUInt32BE(16)).toBe(1600);
    expect(png.readUInt32BE(20)).toBe(960);

    await expect(fs.readdir(path.join(root, 'charts'))).resolves.toEqual(['月销售额.png', '月销售额.svg']);
  });

  it('rasterizes a pie chart with Chinese labels into a non-blank image', async () => {
    const svg = renderChartSvg({
      type: 'pie',
      title: '尾款占比',
      labels: ['已收', '未收'],
      series: [{ name: '', values: [70, 30] }],
    });
    const png = await rasterizeSvgToPng(svg, { scale: 1 });
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(png.readUInt32BE(16)).toBe(800);
    expect(png.readUInt32BE(20)).toBe(480);
    // 纯白画布的 PNG 只有几百字节；画了饼块与文字之后明显更大
    expect(png.length).toBeGreaterThan(5_000);
  });
});

describe('readWorkspaceImageDataUrl', () => {
  it('returns a data url for svg/png inside the workspace and null for other or oversized files', async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await fs.writeFile(path.join(root, 'a.txt'), 'x');
    await fs.writeFile(path.join(root, 'big.png'), Buffer.alloc(MAX_PREVIEW_IMAGE_BYTES + 1));

    await expect(readWorkspaceImageDataUrl(root, 'a.svg')).resolves.toMatch(/^data:image\/svg\+xml;base64,/);
    await expect(readWorkspaceImageDataUrl(root, 'a.txt')).resolves.toBeNull();
    await expect(readWorkspaceImageDataUrl(root, 'big.png')).resolves.toBeNull();
    await expect(readWorkspaceImageDataUrl(root, '../a.svg')).rejects.toThrow();
  });
});
