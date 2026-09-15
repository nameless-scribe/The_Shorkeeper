/**
 * 图片预处理（P8.0，计划 §2.2、§4.2）：格式判断、BMP / GIF 转 PNG、超像素上限时缩到最长边 3600。
 * 原则：能原样送就原样送（PNG / JPEG / WebP 且像素不超），**不为省钱压图**（P5.0 的教训）。
 * 用 @napi-rs/canvas 解码与重编码，与 PDF 抽图同一套依赖。
 */
import { estimateImageTokens, fitWithinLimits, mimeForExtension, VISION_NATIVE_EXTENSIONS } from './contract';

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

export interface PreparedImage {
  dataUrl: string;
  mime: string;
  width: number;
  height: number;
  /** 送出的字节数（base64 之前） */
  bytes: number;
  /** 原格式不被支持，转成了 PNG */
  converted: boolean;
  /** 超过像素上限，缩过 */
  resized: boolean;
  estimatedTokens: number;
}

export class ImagePrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePrepError';
  }
}

export async function prepareImageForVision(buffer: Buffer, extension: string): Promise<PreparedImage> {
  const mime = mimeForExtension(extension);
  if (!mime) throw new ImagePrepError(`不支持的图片格式：${extension}`);
  const { loadImage, createCanvas } = await loadCanvas();
  let image;
  try {
    image = await loadImage(buffer);
  } catch (error) {
    throw new ImagePrepError(`图片解码失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const width = image.width;
  const height = image.height;
  if (!width || !height) throw new ImagePrepError('图片尺寸为 0');
  const target = fitWithinLimits(width, height);
  const native = VISION_NATIVE_EXTENSIONS.has(extension.toLowerCase());
  if (native && !target.resized) {
    return {
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      mime,
      width,
      height,
      bytes: buffer.byteLength,
      converted: false,
      resized: false,
      estimatedTokens: estimateImageTokens(width, height),
    };
  }
  const canvas = createCanvas(target.width, target.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, target.width, target.height);
  const png = canvas.toBuffer('image/png');
  return {
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    mime: 'image/png',
    width: target.width,
    height: target.height,
    bytes: png.byteLength,
    converted: !native,
    resized: target.resized,
    estimatedTokens: estimateImageTokens(target.width, target.height),
  };
}
