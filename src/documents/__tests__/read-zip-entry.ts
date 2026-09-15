/**
 * 测试专用：从 zip 容器（docx / xlsx）里取一个条目的内容，不引入 zip 依赖。
 * 从中央目录定位条目，兼容本地文件头里尺寸为 0 的流式写法。
 */
import zlib from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

export function listZipEntries(buffer: Buffer): string[] {
  return [...iterateCentralDirectory(buffer)].map((entry) => entry.name);
}

export function readZipEntry(buffer: Buffer, name: string): string {
  for (const entry of iterateCentralDirectory(buffer)) {
    if (entry.name !== name) continue;
    if (buffer.readUInt32LE(entry.localOffset) !== LOCAL_FILE_HEADER) throw new Error(`本地文件头损坏：${name}`);
    const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
    const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const data = buffer.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data.toString('utf-8');
    if (entry.method === 8) return zlib.inflateRawSync(data).toString('utf-8');
    throw new Error(`不支持的压缩方式 ${entry.method}：${name}`);
  }
  throw new Error(`zip 里没有 ${name}`);
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function* iterateCentralDirectory(buffer: Buffer): Generator<CentralEntry> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是 zip 文件：找不到中央目录结尾');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw new Error('中央目录条目损坏');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf-8', offset + 46, offset + 46 + nameLength);
    yield { name, method, compressedSize, localOffset };
    offset += 46 + nameLength + extraLength + commentLength;
  }
}
