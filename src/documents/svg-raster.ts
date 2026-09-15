/**
 * SVG → PNG，走 @napi-rs/canvas（已是直接依赖，PDF 抽图也用它）。
 * 2026-09-15 探针：`loadImage(Buffer.from(svg))` 能画，中文用系统字体栈落到微软雅黑；
 * 失败时抛错，由调用方决定只出 SVG。
 */

type CanvasModule = typeof import('@napi-rs/canvas');

let canvasModule: Promise<CanvasModule> | null = null;

function loadCanvas(): Promise<CanvasModule> {
  if (!canvasModule) {
    canvasModule = import('@napi-rs/canvas').catch((error) => {
      canvasModule = null;
      throw error;
    });
  }
  return canvasModule;
}

const RASTER_TIMEOUT_MS = 10_000;

export interface RasterizeOptions {
  /** 输出宽度（像素）；高度按 SVG 宽高比。默认取 SVG 自身尺寸的 2 倍，屏幕上看清楚 */
  scale?: number;
  background?: string;
}

export async function rasterizeSvgToPng(svg: string, options: RasterizeOptions = {}): Promise<Buffer> {
  const { createCanvas, loadImage } = await loadCanvas();
  const image = await withTimeout(loadImage(Buffer.from(svg, 'utf-8')), RASTER_TIMEOUT_MS, 'SVG 解码');
  const scale = options.scale ?? 2;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = options.background ?? '#FFFFFF';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toBuffer('image/png');
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超过 ${ms / 1000} 秒`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
