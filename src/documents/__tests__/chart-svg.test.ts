import { describe, expect, it } from 'vitest';
import {
  CHART_HEIGHT,
  CHART_PALETTE,
  CHART_WIDTH,
  ChartSpecError,
  formatNumber,
  niceTicks,
  renderChartSvg,
} from '../chart-svg';

const MONTHS = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月'];

describe('renderChartSvg', () => {
  it('draws a single-series bar chart with title, source, axes and one rect per value', () => {
    const svg = renderChartSvg({
      type: 'bar',
      title: '上半年销售额',
      labels: MONTHS,
      series: [{ name: '', values: [120, 98.5, 143, 0, 210, 176] }],
      source: 'sales.xlsx 工作表 1 A2:B7',
    });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${CHART_WIDTH}" height="${CHART_HEIGHT}"`);
    expect(svg).toContain('<title>上半年销售额</title>');
    expect(svg).toContain('<desc>来源：sales.xlsx 工作表 1 A2:B7</desc>');
    expect(svg.match(/<rect [^>]*fill="#2F6FED"/g)).toHaveLength(6);
    expect(svg).toContain('<title>5 月：210</title>');
    expect(svg).toContain('<title>2 月：98.5</title>');
    // 单系列不画图例；类目少于 10 个不旋转
    expect(svg).not.toContain('rotate(');
    expect(svg.match(/<rect [^>]*rx="2"/g)).toBeNull();
    // 零值的柱高为 0，不报错
    expect(svg).toContain('height="0"');
    expect(svg).toContain('font-family=');
  });

  it('draws grouped bars with a legend and negative values below the zero line', () => {
    const svg = renderChartSvg({
      type: 'bar',
      title: '收支',
      labels: ['Q1', 'Q2'],
      series: [
        { name: '收入', values: [100, 120] },
        { name: '支出', values: [-80, -95] },
      ],
    });
    expect(svg.match(/<rect [^>]*rx="2"/g)).toHaveLength(2);
    expect(svg).toContain('>收入</text>');
    expect(svg).toContain(`fill="${CHART_PALETTE[1]}"`);
    expect(svg).toContain('<title>支出 · Q1：-80</title>');
    expect(svg).toContain('<desc>由 TheShorekeeper gen_chart 生成</desc>');
  });

  it('draws multi-series lines with one path per series and rotates crowded labels', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `${i + 1} 月`);
    const svg = renderChartSvg({
      type: 'line',
      title: '趋势',
      labels,
      series: [
        { name: '今年', values: labels.map((_, i) => 50 + i * 3) },
        { name: '去年', values: labels.map((_, i) => 48 + i * 2.5) },
      ],
    });
    expect(svg.match(/<path d="M/g)).toHaveLength(2);
    expect(svg.match(/<circle /g)).toHaveLength(24);
    expect(svg).toContain('rotate(-35');
  });

  it('draws a pie with slices, percentages and a legend, and a full circle for a single non-zero share', () => {
    const svg = renderChartSvg({
      type: 'pie',
      title: '渠道占比',
      labels: ['直销', '代理', '线上', '其他'],
      series: [{ name: '', values: [50, 30, 19, 1] }],
    });
    expect(svg.match(/<path d="M300/g)).toHaveLength(4);
    expect(svg).toContain('>50%</text>');
    expect(svg).toContain('>30%</text>');
    // 1% 的小块不写百分比，但图例里有
    expect(svg).toContain('1 · 1.0%');
    expect(svg).toContain('<title>其他：1（1.0%）</title>');

    const single = renderChartSvg({ type: 'pie', title: '单块', labels: ['全部', '无'], series: [{ name: '', values: [7, 0] }] });
    expect(single).toContain('<circle cx="300"');
    expect(single).not.toContain('<path d="M300');
  });

  it('escapes XML in titles, labels and series names, and truncates long labels with the full text in a tooltip', () => {
    const svg = renderChartSvg({
      type: 'bar',
      title: 'A & B <测试>',
      labels: ['这是一个非常非常长的类目名称超过十二个字'],
      series: [{ name: 'x"y', values: [1] }, { name: 'z', values: [2] }],
    });
    expect(svg).toContain('<title>A &amp; B &lt;测试&gt;</title>');
    expect(svg).not.toContain('<测试>');
    expect(svg).toContain('这是一个非常非常长的类…</text>');
    expect(svg).toContain('<title>这是一个非常非常长的类目名称超过十二个字</title>');
    expect(svg).toContain('x&quot;y');
  });

  it('rejects empty data, mismatched lengths, too many categories, bad numbers and multi-series pies', () => {
    const base = { type: 'bar' as const, title: 't' };
    expect(() => renderChartSvg({ ...base, labels: [], series: [{ name: '', values: [] }] })).toThrow(/labels 不能为空/);
    expect(() => renderChartSvg({ ...base, labels: ['a'], series: [] })).toThrow(/series 不能为空/);
    expect(() => renderChartSvg({ ...base, labels: ['a', 'b'], series: [{ name: 's', values: [1] }] })).toThrow(/对不上/);
    expect(() => renderChartSvg({ ...base, labels: ['a'], series: [{ name: 's', values: [Number.NaN] }] })).toThrow(/不是数字/);
    const many = Array.from({ length: 51 }, (_, i) => `c${i}`);
    expect(() => renderChartSvg({ ...base, labels: many, series: [{ name: '', values: many.map(() => 1) }] })).toThrow(/先按月份、类别等聚合/);
    expect(() =>
      renderChartSvg({ type: 'pie', title: 't', labels: ['a'], series: [{ name: '1', values: [1] }, { name: '2', values: [2] }] }),
    ).toThrow(/饼图只能有一个系列/);
    expect(() => renderChartSvg({ type: 'pie', title: 't', labels: ['a'], series: [{ name: '', values: [-1] }] })).toThrow(/不能为负/);
    expect(() => renderChartSvg({ type: 'pie', title: 't', labels: ['a'], series: [{ name: '', values: [0] }] })).toThrow(/全为 0/);
    expect(() => renderChartSvg({ ...base, title: ' ', labels: ['a'], series: [{ name: '', values: [1] }] })).toThrow(ChartSpecError);
    expect(() => renderChartSvg({ ...base, type: 'area' as 'bar', labels: ['a'], series: [{ name: '', values: [1] }] })).toThrow(/type/);
  });

  it('accepts constant series without dividing by zero', () => {
    const flat = renderChartSvg({ type: 'line', title: '平', labels: ['a', 'b'], series: [{ name: '', values: [5, 5] }] });
    expect(flat).not.toContain('NaN');
    const zeros = renderChartSvg({ type: 'bar', title: '零', labels: ['a', 'b'], series: [{ name: '', values: [0, 0] }] });
    expect(zeros).not.toContain('NaN');
  });
});

describe('niceTicks / formatNumber', () => {
  it('produces 1-2-5 steps that cover the range', () => {
    expect(niceTicks(0, 210, 5)).toEqual([0, 50, 100, 150, 200, 250]);
    expect(niceTicks(-95, 120, 5)).toEqual([-100, -50, 0, 50, 100, 150]);
    expect(niceTicks(0.1, 0.9, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(48, 83, 5)).toEqual([40, 50, 60, 70, 80, 90]);
  });

  it('formats numbers with grouping and sensible decimals', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(98.5)).toBe('98.5');
    expect(formatNumber(3.14159)).toBe('3.14');
    expect(formatNumber(-80)).toBe('-80');
    expect(formatNumber(0.2)).toBe('0.2');
  });
});
