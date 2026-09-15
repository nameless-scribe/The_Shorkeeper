import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { ImagePrepError, prepareImageForVision } from '../image-prep';

function bmp(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const dataSize = rowSize * height;
  const buffer = Buffer.alloc(54 + dataSize);
  buffer.write('BM', 0);
  buffer.writeUInt32LE(54 + dataSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(dataSize, 34);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowSize + x * 3;
      buffer[offset + 2] = 255;
    }
  }
  return buffer;
}

describe('prepareImageForVision', () => {
  it('sends supported formats untouched (no re-encoding, no shrinking)', async () => {
    const canvas = createCanvas(64, 48);
    const png = canvas.toBuffer('image/png');
    const prepared = await prepareImageForVision(png, '.png');
    expect(prepared).toMatchObject({ mime: 'image/png', width: 64, height: 48, bytes: png.byteLength, converted: false, resized: false, estimatedTokens: 5 });
    expect(prepared.dataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`);
    const jpeg = canvas.toBuffer('image/jpeg');
    expect((await prepareImageForVision(jpeg, '.jpg')).dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('converts BMP to PNG and rejects undecodable data', async () => {
    const prepared = await prepareImageForVision(bmp(3, 2), '.bmp');
    expect(prepared).toMatchObject({ mime: 'image/png', width: 3, height: 2, converted: true, resized: false });
    expect(prepared.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    await expect(prepareImageForVision(Buffer.from('not an image'), '.png')).rejects.toBeInstanceOf(ImagePrepError);
    await expect(prepareImageForVision(Buffer.alloc(4), '.tiff')).rejects.toThrow('不支持的图片格式');
  });
});
