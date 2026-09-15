/**
 * 把 PDF 页面上的图解成可落盘的 JPEG / PNG（P5.0 返工）。
 *
 * 像素从 pdf.js 的对象表里取（page.objs / page.commonObjs），因此必须在 getOperatorList()
 * 之后、page.cleanup() 之前调用。被切成细条绘制的照片按各条在页面上的位置拼回一张。
 * 依赖 @napi-rs/canvas（已是直接依赖，pdf.js 在 Node 里渲染也用它）。
 */

import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api.js';
import type { PdfImagePaint, PdfImagePlacement } from './pdf-layout';

type CanvasModule = typeof import('@napi-rs/canvas');
type Canvas = import('@napi-rs/canvas').Canvas;

export interface EncodedPdfImage {
  bytes: Uint8Array;
  ext: 'jpg' | 'png';
  width: number;
  height: number;
}

export interface PdfImageEncodeOptions {
  /** 最长边上限（像素） */
  maxEdge?: number;
  jpegQuality?: number;
}

/** pdf.js ImageKind：1 位黑白、24 位 RGB、32 位 RGBA */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;
/**
 * 最长边上限。扫描的图纸常是 600 dpi（A4 一页 5000×7000 像素），压到 1280 时尺寸标注就糊了；
 * 3600 相当于 A4 约 300 dpi，标注可读，一页 JPEG 约 1 MB。照片类小图不会被放大。
 */
export const DEFAULT_IMAGE_MAX_EDGE = 3600;
export const DEFAULT_JPEG_QUALITY = 85;
/** 拼接条块时的采样密度上限（像素 / pt），6 相当于 432 dpi，再往上只是放大扫描噪点 */
const MAX_COMPOSITE_SCALE = 6;

interface RawImage {
  width: number;
  height: number;
  kind?: number;
  data?: ArrayBufferView | null;
  bitmap?: unknown;
}

/** 等一个图片对象解码的上限；超时按"这张图抽不出来"处理，绝不让整次转换挂死 */
const OBJECT_RESOLVE_TIMEOUT_MS = 20_000;

function getPageObject(page: PDFPageProxy, name: string): Promise<RawImage | null> {
  // 与 pdf.js 内部一致：跨页共享的对象以 g_ 开头、存在 commonObjs；
  // 不能用 commonObjs.has() 判断——对象尚未解析完时它返回 false，去 page.objs 上等就永远等不到
  const objects = name.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`图片对象 ${name} 在 ${OBJECT_RESOLVE_TIMEOUT_MS / 1000} 秒内未解码完成`)),
      OBJECT_RESOLVE_TIMEOUT_MS,
    );
    // 回调形式：对象尚未解析完时会等它解析完再回调
    objects.get(name, (value: unknown) => {
      clearTimeout(timer);
      resolve(value && typeof value === 'object' ? (value as RawImage) : null);
    });
  });
}

/** 各种像素格式统一成 RGBA，写进 canvas。 */
function rawToCanvas(raw: RawImage, canvasModule: CanvasModule): Canvas {
  const { width, height } = raw;
  if (!(width > 0 && height > 0)) throw new Error('图片尺寸无效');
  const canvas = canvasModule.createCanvas(width, height);
  const context = canvas.getContext('2d');

  if (raw.bitmap && typeof raw.bitmap === 'object') {
    context.drawImage(raw.bitmap as never, 0, 0);
    return canvas;
  }
  if (!raw.data || !ArrayBuffer.isView(raw.data)) throw new Error('图片对象没有像素数据');
  const src = new Uint8Array(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
  const imageData = context.createImageData(width, height);
  const dest = imageData.data;
  const pixels = width * height;
  const kind = raw.kind ?? inferKind(src.length, pixels);

  if (kind === RGBA_32BPP) {
    dest.set(src.subarray(0, pixels * 4));
  } else if (kind === RGB_24BPP) {
    for (let i = 0, j = 0; i < pixels; i += 1, j += 3) {
      dest[i * 4] = src[j];
      dest[i * 4 + 1] = src[j + 1];
      dest[i * 4 + 2] = src[j + 2];
      dest[i * 4 + 3] = 255;
    }
  } else if (kind === GRAYSCALE_1BPP) {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = src[y * rowBytes + (x >> 3)];
        const white = ((byte >> (7 - (x & 7))) & 1) === 1;
        const gray = white ? 255 : 0;
        const offset = (y * width + x) * 4;
        dest[offset] = gray;
        dest[offset + 1] = gray;
        dest[offset + 2] = gray;
        dest[offset + 3] = 255;
      }
    }
  } else {
    throw new Error(`不支持的像素格式 kind=${kind}`);
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function inferKind(byteLength: number, pixels: number): number {
  const perPixel = byteLength / pixels;
  if (Math.abs(perPixel - 4) < 0.1) return RGBA_32BPP;
  if (Math.abs(perPixel - 3) < 0.1) return RGB_24BPP;
  throw new Error(`无法推断像素格式（每像素 ${perPixel.toFixed(2)} 字节）`);
}

function fitScale(width: number, height: number, maxEdge: number): number {
  return Math.min(1, maxEdge / Math.max(width, height));
}

function encode(canvas: Canvas, ext: 'jpg' | 'png', quality: number): EncodedPdfImage {
  const bytes = ext === 'jpg' ? canvas.toBuffer('image/jpeg', quality) : canvas.toBuffer('image/png');
  return { bytes: new Uint8Array(bytes), ext, width: canvas.width, height: canvas.height };
}

async function renderMember(page: PDFPageProxy, member: PdfImagePaint, canvasModule: CanvasModule): Promise<Canvas> {
  const raw = await getPageObject(page, member.name);
  if (!raw) throw new Error(`图片对象 ${member.name} 不存在`);
  return rawToCanvas(raw, canvasModule);
}

/**
 * 把一张"图"（一次绘制或多条拼接）解成 JPEG（照片）或 PNG（1 位黑白）。
 */
export async function renderPlacementImage(
  page: PDFPageProxy,
  placement: PdfImagePlacement,
  canvasModule: CanvasModule,
  options: PdfImageEncodeOptions = {},
): Promise<EncodedPdfImage> {
  const maxEdge = options.maxEdge ?? DEFAULT_IMAGE_MAX_EDGE;
  const quality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;

  if (placement.members.length === 1) {
    const member = placement.members[0];
    const raw = await getPageObject(page, member.name);
    if (!raw) throw new Error(`图片对象 ${member.name} 不存在`);
    const source = rawToCanvas(raw, canvasModule);
    const scale = fitScale(source.width, source.height, maxEdge);
    const ext: 'jpg' | 'png' = raw.kind === GRAYSCALE_1BPP ? 'png' : 'jpg';
    if (scale === 1) return encode(source, ext, quality);
    const target = canvasModule.createCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    const context = target.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(source, 0, 0, target.width, target.height);
    return encode(target, ext, quality);
  }

  // 多条拼接：采样密度取各条自身的像素密度，封顶后再受最长边约束
  let density = 1;
  const memberCanvases: Array<{ member: PdfImagePaint; canvas: Canvas }> = [];
  for (const member of placement.members) {
    const canvas = await renderMember(page, member, canvasModule);
    memberCanvases.push({ member, canvas });
    if (member.width > 0) density = Math.max(density, canvas.width / member.width);
  }
  density = Math.min(density, MAX_COMPOSITE_SCALE);
  density *= fitScale(placement.width * density, placement.height * density, maxEdge);
  const target = canvasModule.createCanvas(
    Math.max(1, Math.round(placement.width * density)),
    Math.max(1, Math.round(placement.height * density)),
  );
  const context = target.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, target.width, target.height);
  for (const { member, canvas } of memberCanvases) {
    const x = (member.x - placement.x) * density;
    const y = (member.y - placement.y) * density;
    // 细条高度不足一个像素时至少画一个像素，避免留缝
    context.drawImage(canvas, x, y, Math.max(1, member.width * density), Math.max(1, member.height * density));
  }
  return encode(target, 'jpg', quality);
}
