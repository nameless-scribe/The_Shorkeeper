import fs from 'node:fs/promises';
import type { ToolDefinition, ToolResult } from '../types';
import { WORKSPACE_WRITE_CONTRACT } from '../contract';
import { buildFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import {
  ChartSpecError,
  MAX_CHART_CATEGORIES,
  MAX_CHART_SERIES,
  renderChartSvg,
  type ChartSpec,
} from '../../documents/chart-svg';
import { rasterizeSvgToPng } from '../../documents/svg-raster';

function invalid(error: string): ToolResult {
  return { success: false, output: '', error, errorCategory: 'invalid_arguments' };
}

export const genChartTool: ToolDefinition = {
  name: 'gen_chart',
  description:
    '把一组数据画成柱状 / 折线 / 饼图，落成工作区 .svg（同时尽量出一份同名 .png）。适合 read_xlsx 读出的数据或查询结果；类目最多 50 个，超过请先聚合',
  category: 'doc',
  requiresPermission: ['filesystem:write'],
  sideEffects: WORKSPACE_WRITE_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '输出路径，须以 .svg 结尾，如 charts/月销售额.svg' },
      type: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'bar 柱状（可多系列分组）、line 折线（可多系列）、pie 饼图（单系列）' },
      title: { type: 'string', description: '图表标题' },
      labels: { type: 'array', items: { type: 'string' }, description: `类目名（横轴 / 饼块），最多 ${MAX_CHART_CATEGORIES} 个` },
      series: {
        type: 'array',
        description: `数据系列，每个系列的 values 长度须与 labels 一致；最多 ${MAX_CHART_SERIES} 个系列，饼图只能 1 个`,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '系列名，单系列可为空串' },
            values: { type: 'array', items: { type: 'number' } },
          },
          required: ['name', 'values'],
        },
      },
      source: { type: 'string', description: '数据来源说明，写进图里，如"sales.xlsx 工作表 1 A2:B13"' },
    },
    required: ['path', 'type', 'title', 'labels', 'series'],
  },
  async execute(args, ctx) {
    const { path: filePath, type, title, labels, series, source } = args as {
      path?: string;
      type?: ChartSpec['type'];
      title?: string;
      labels?: string[];
      series?: ChartSpec['series'];
      source?: string;
    };
    const outputPath = filePath?.trim();
    if (!outputPath) return invalid('缺少 path 参数');
    if (!outputPath.toLowerCase().endsWith('.svg')) return invalid('path 须以 .svg 结尾');
    if (!type || !title || !labels || !series) return invalid('缺少 type、title、labels 或 series');

    let svg: string;
    try {
      svg = renderChartSvg({ type, title, labels, series, source });
    } catch (error) {
      if (error instanceof ChartSpecError) return invalid(error.message);
      throw error;
    }

    try {
      const svgArtifact = await writeWorkspaceFileAtomically(ctx.workspaceRoot, outputPath, (temporaryPath) =>
        fs.writeFile(temporaryPath, svg, 'utf-8'),
        { signal: ctx.signal },
      );
      const artifacts = [svgArtifact];
      const pngPath = `${outputPath.slice(0, -4)}.png`;
      let pngNote = '';
      try {
        const png = await rasterizeSvgToPng(svg);
        await writeWorkspaceFileAtomically(
          ctx.workspaceRoot,
          pngPath,
          (temporaryPath) => fs.writeFile(temporaryPath, png),
          { signal: ctx.signal },
        );
        artifacts.push(await buildFileArtifact(ctx.workspaceRoot, pngPath));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pngNote = `；PNG 未生成（${message}），SVG 可直接用`;
      }
      const seriesCount = series.length;
      return {
        success: true,
        output: `已生成图表 ${outputPath}${artifacts.length > 1 ? ` 与 ${pngPath}` : ''}（${describeType(type)}，${labels.length} 个类目${seriesCount > 1 ? `、${seriesCount} 个系列` : ''}）${pngNote}`,
        metadata: { type, categories: labels.length, series: seriesCount, png: artifacts.length > 1 },
        artifacts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, output: '', error: message };
    }
  },
};

function describeType(type: ChartSpec['type']): string {
  return type === 'bar' ? '柱状图' : type === 'line' ? '折线图' : '饼图';
}
