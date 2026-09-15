/**
 * 图表产物的 L1（P5.3，供 `gen_chart`）：柱状 / 折线 / 饼图 → SVG 字符串。纯函数，无外部库。
 *
 * 版式固定（计划 §4.5：不给模型调样式的口子）：800×480 画布、6 色调色板、系统字体栈与 PDF 一致；
 * `<title>` 放标题，`<desc>` 放来源。多系列柱状图分组并排，折线图多条线，饼图只收一个系列。
 * 类目超过 50 个拒绝并建议先聚合——那不是图表能读清的粒度。
 */

import { PRINT_FONT_STACK } from './markdown-to-html';

export type ChartType = 'bar' | 'line' | 'pie';

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSpec {
  type: ChartType;
  title: string;
  labels: string[];
  series: ChartSeries[];
  /** 数据来源说明，写进 `<desc>`，如"sales.xlsx 表 1 A2:B13" */
  source?: string;
}

export class ChartSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartSpecError';
  }
}

export const CHART_WIDTH = 800;
export const CHART_HEIGHT = 480;
export const MAX_CHART_CATEGORIES = 50;
export const MAX_CHART_SERIES = 6;
export const CHART_PALETTE = ['#2F6FED', '#F0883E', '#3BB273', '#E4508F', '#8E5BE0', '#1AA6B7'] as const;

const MARGIN = { top: 64, right: 32, bottom: 72, left: 72 };
const LEGEND_HEIGHT = 24;
const AXIS_COLOR = '#8A8A8A';
const GRID_COLOR = '#E3E5E8';
const TEXT_COLOR = '#222222';
const MUTED_COLOR = '#666666';
const LABEL_MAX_CHARS = 12;
const ROTATE_LABELS_FROM = 10;

export function validateChartSpec(spec: ChartSpec): void {
  if (!['bar', 'line', 'pie'].includes(spec.type)) throw new ChartSpecError('type 只能是 bar、line 或 pie');
  if (typeof spec.title !== 'string' || !spec.title.trim()) throw new ChartSpecError('缺少标题');
  if (!Array.isArray(spec.labels) || spec.labels.length === 0) throw new ChartSpecError('labels 不能为空：没有数据画不了图');
  if (spec.labels.length > MAX_CHART_CATEGORIES) {
    throw new ChartSpecError(
      `类目太多（${spec.labels.length} 个，上限 ${MAX_CHART_CATEGORIES}）：一张图读不清，请先按月份、类别等聚合后再画`,
    );
  }
  if (spec.labels.some((label) => typeof label !== 'string')) throw new ChartSpecError('labels 必须都是字符串');
  if (!Array.isArray(spec.series) || spec.series.length === 0) throw new ChartSpecError('series 不能为空：没有数据画不了图');
  if (spec.series.length > MAX_CHART_SERIES) throw new ChartSpecError(`系列太多（${spec.series.length} 个，上限 ${MAX_CHART_SERIES}）`);
  if (spec.type === 'pie' && spec.series.length !== 1) throw new ChartSpecError('饼图只能有一个系列；要比较多个系列请用柱状图');
  spec.series.forEach((series, index) => {
    if (!series || typeof series.name !== 'string') throw new ChartSpecError(`第 ${index + 1} 个系列缺少 name`);
    if (!Array.isArray(series.values) || series.values.length !== spec.labels.length) {
      throw new ChartSpecError(
        `系列「${series.name}」有 ${Array.isArray(series.values) ? series.values.length : 0} 个值，与 ${spec.labels.length} 个类目对不上`,
      );
    }
    if (series.values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new ChartSpecError(`系列「${series.name}」里有不是数字的值`);
    }
    if (spec.type === 'pie') {
      if (series.values.some((value) => value < 0)) throw new ChartSpecError('饼图的值不能为负');
      if (series.values.reduce((sum, value) => sum + value, 0) <= 0) throw new ChartSpecError('饼图的值全为 0，没有可画的份额');
    }
  });
  if (spec.source !== undefined && typeof spec.source !== 'string') throw new ChartSpecError('source 必须是字符串');
}

export function renderChartSvg(spec: ChartSpec): string {
  validateChartSpec(spec);
  const body = spec.type === 'pie' ? renderPie(spec) : spec.type === 'bar' ? renderBars(spec) : renderLines(spec);
  const desc = spec.source?.trim() ? `来源：${spec.source.trim()}` : '由 TheShorekeeper gen_chart 生成';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" font-family='${PRINT_FONT_STACK}' font-size="13">`,
    `<title>${escapeXml(spec.title.trim())}</title>`,
    `<desc>${escapeXml(desc)}</desc>`,
    `<rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#FFFFFF"/>`,
    `<text x="${CHART_WIDTH / 2}" y="34" text-anchor="middle" font-size="20" font-weight="600" fill="${TEXT_COLOR}">${escapeXml(spec.title.trim())}</text>`,
    body,
    '</svg>',
  ].join('\n');
}

// ---------- 坐标轴类图（柱状、折线） ----------

interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
  ticks: number[];
  scaleY: (value: number) => number;
}

function buildFrame(spec: ChartSpec, includeZero: boolean): Frame {
  const values = spec.series.flatMap((series) => series.values);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    // 全部相等：撑开一格，避免除零
    max = min === 0 ? 1 : min + Math.abs(min) * 0.1;
    if (min !== 0) min -= Math.abs(min) * 0.1;
  }
  const ticks = niceTicks(min, max, 5);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const legend = spec.series.length > 1 ? LEGEND_HEIGHT : 0;
  const top = MARGIN.top + legend;
  const bottom = CHART_HEIGHT - MARGIN.bottom;
  return {
    left: MARGIN.left,
    right: CHART_WIDTH - MARGIN.right,
    top,
    bottom,
    ticks,
    scaleY: (value) => bottom - ((value - lo) / (hi - lo)) * (bottom - top),
  };
}

/** 取 1 / 2 / 5 × 10^n 的整齐刻度，覆盖 [min, max] */
export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  const rough = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

function renderAxes(spec: ChartSpec, frame: Frame): string {
  const parts: string[] = [];
  for (const tick of frame.ticks) {
    const y = frame.scaleY(tick);
    parts.push(`<line x1="${frame.left}" y1="${fmt(y)}" x2="${frame.right}" y2="${fmt(y)}" stroke="${tick === 0 ? AXIS_COLOR : GRID_COLOR}" stroke-width="1"/>`);
    parts.push(`<text x="${frame.left - 8}" y="${fmt(y + 4)}" text-anchor="end" font-size="12" fill="${MUTED_COLOR}">${formatNumber(tick)}</text>`);
  }
  parts.push(`<line x1="${frame.left}" y1="${frame.top}" x2="${frame.left}" y2="${frame.bottom}" stroke="${AXIS_COLOR}" stroke-width="1"/>`);
  const slot = (frame.right - frame.left) / spec.labels.length;
  const rotate = spec.labels.length > ROTATE_LABELS_FROM;
  spec.labels.forEach((label, index) => {
    const x = frame.left + slot * (index + 0.5);
    const y = frame.bottom + 20;
    const text = truncateLabel(label);
    const attrs = rotate
      ? `x="${fmt(x)}" y="${y}" text-anchor="end" transform="rotate(-35 ${fmt(x)} ${y})"`
      : `x="${fmt(x)}" y="${y}" text-anchor="middle"`;
    parts.push(`<text ${attrs} font-size="12" fill="${MUTED_COLOR}"><title>${escapeXml(label)}</title>${escapeXml(text)}</text>`);
  });
  return parts.join('\n');
}

function renderLegend(spec: ChartSpec): string {
  if (spec.series.length <= 1) return '';
  const itemWidth = Math.min(160, (CHART_WIDTH - MARGIN.left - MARGIN.right) / spec.series.length);
  const startX = CHART_WIDTH / 2 - (itemWidth * spec.series.length) / 2;
  const y = MARGIN.top - 4;
  return spec.series
    .map((series, index) => {
      const x = startX + itemWidth * index;
      return (
        `<rect x="${fmt(x)}" y="${y - 10}" width="12" height="12" rx="2" fill="${color(index)}"/>` +
        `<text x="${fmt(x + 18)}" y="${y + 1}" font-size="12" fill="${TEXT_COLOR}">${escapeXml(truncateLabel(series.name, 14))}</text>`
      );
    })
    .join('\n');
}

function renderBars(spec: ChartSpec): string {
  const frame = buildFrame(spec, true);
  const slot = (frame.right - frame.left) / spec.labels.length;
  const groupWidth = slot * 0.7;
  const barWidth = groupWidth / spec.series.length;
  const zeroY = frame.scaleY(0);
  const bars: string[] = [];
  spec.series.forEach((series, seriesIndex) => {
    series.values.forEach((value, index) => {
      const x = frame.left + slot * index + (slot - groupWidth) / 2 + barWidth * seriesIndex;
      const y = frame.scaleY(value);
      const top = Math.min(y, zeroY);
      const height = Math.abs(zeroY - y);
      bars.push(
        `<rect x="${fmt(x)}" y="${fmt(top)}" width="${fmt(Math.max(1, barWidth - 2))}" height="${fmt(height)}" fill="${color(seriesIndex)}"><title>${escapeXml(`${series.name ? `${series.name} · ` : ''}${spec.labels[index]}：${formatNumber(value)}`)}</title></rect>`,
      );
    });
  });
  return [renderAxes(spec, frame), renderLegend(spec), ...bars].join('\n');
}

function renderLines(spec: ChartSpec): string {
  const frame = buildFrame(spec, false);
  const slot = (frame.right - frame.left) / spec.labels.length;
  const lines: string[] = [];
  spec.series.forEach((series, seriesIndex) => {
    const points = series.values.map((value, index) => ({
      x: frame.left + slot * (index + 0.5),
      y: frame.scaleY(value),
    }));
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${fmt(point.x)} ${fmt(point.y)}`).join(' ');
    lines.push(`<path d="${path}" fill="none" stroke="${color(seriesIndex)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
    points.forEach((point, index) => {
      lines.push(
        `<circle cx="${fmt(point.x)}" cy="${fmt(point.y)}" r="3.5" fill="#FFFFFF" stroke="${color(seriesIndex)}" stroke-width="2"><title>${escapeXml(`${series.name ? `${series.name} · ` : ''}${spec.labels[index]}：${formatNumber(series.values[index])}`)}</title></circle>`,
      );
    });
  });
  return [renderAxes(spec, frame), renderLegend(spec), ...lines].join('\n');
}

// ---------- 饼图 ----------

function renderPie(spec: ChartSpec): string {
  const values = spec.series[0].values;
  const total = values.reduce((sum, value) => sum + value, 0);
  const cx = 300;
  const cy = (CHART_HEIGHT + MARGIN.top) / 2 - 8;
  const r = 150;
  const parts: string[] = [];
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    if (value <= 0) return;
    const share = value / total;
    const sweep = share * Math.PI * 2;
    const end = angle + sweep;
    const tip = `${spec.labels[index]}：${formatNumber(value)}（${(share * 100).toFixed(1)}%）`;
    if (share >= 0.9999) {
      parts.push(`<circle cx="${cx}" cy="${fmt(cy)}" r="${r}" fill="${color(index)}"><title>${escapeXml(tip)}</title></circle>`);
    } else {
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = sweep > Math.PI ? 1 : 0;
      parts.push(
        `<path d="M${cx} ${fmt(cy)} L${fmt(x1)} ${fmt(y1)} A${r} ${r} 0 ${large} 1 ${fmt(x2)} ${fmt(y2)} Z" fill="${color(index)}" stroke="#FFFFFF" stroke-width="2"><title>${escapeXml(tip)}</title></path>`,
      );
    }
    if (share >= 0.04) {
      const mid = angle + sweep / 2;
      const lx = cx + r * 0.62 * Math.cos(mid);
      const ly = cy + r * 0.62 * Math.sin(mid);
      parts.push(`<text x="${fmt(lx)}" y="${fmt(ly + 4)}" text-anchor="middle" font-size="12" fill="#FFFFFF">${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%</text>`);
    }
    angle = end;
  });
  // 右侧图例：类目 + 数值 + 份额
  const legendX = 500;
  const rowHeight = Math.min(24, (CHART_HEIGHT - MARGIN.top - 40) / Math.max(1, values.length));
  const legendTop = cy - (rowHeight * values.length) / 2 + 8;
  values.forEach((value, index) => {
    const y = legendTop + rowHeight * index;
    const share = total > 0 ? (value / total) * 100 : 0;
    parts.push(`<rect x="${legendX}" y="${fmt(y - 9)}" width="12" height="12" rx="2" fill="${color(index)}"/>`);
    parts.push(
      `<text x="${legendX + 18}" y="${fmt(y + 2)}" font-size="12" fill="${TEXT_COLOR}"><title>${escapeXml(spec.labels[index])}</title>${escapeXml(truncateLabel(spec.labels[index]))}</text>`,
    );
    parts.push(`<text x="${CHART_WIDTH - MARGIN.right}" y="${fmt(y + 2)}" text-anchor="end" font-size="12" fill="${MUTED_COLOR}">${formatNumber(value)} · ${share.toFixed(1)}%</text>`);
  });
  return parts.join('\n');
}

// ---------- 工具 ----------

function color(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(value) ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function truncateLabel(label: string, max = LABEL_MAX_CHARS): string {
  const chars = [...label];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : label;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
