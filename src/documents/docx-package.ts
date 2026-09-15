/**
 * docx 容器读写：只替换 `word/document.xml`，其余部件按原有条目顺序原样透传。
 * 重新打包后 zip 本身的字节会变（压缩器不同），验收以"解压后逐部件比对"为准。
 */
import JSZip from 'jszip';

export const DOCX_DOCUMENT_PART = 'word/document.xml';

export interface DocxPackage {
  documentXml: string;
  /** 所有部件名，按 zip 里的顺序 */
  entries: string[];
}

export async function readDocxPackage(buffer: Uint8Array): Promise<DocxPackage> {
  const zip = await loadZip(buffer);
  const part = zip.file(DOCX_DOCUMENT_PART);
  if (!part) throw new Error('不是 Word 文档：缺少 word/document.xml');
  return {
    documentXml: await part.async('string'),
    entries: Object.keys(zip.files),
  };
}

export async function replaceDocxDocumentXml(buffer: Uint8Array, documentXml: string): Promise<Buffer> {
  const zip = await loadZip(buffer);
  if (!zip.file(DOCX_DOCUMENT_PART)) throw new Error('不是 Word 文档：缺少 word/document.xml');
  // 同名覆盖不改变 files 的键顺序，生成时仍按原顺序写出
  zip.file(DOCX_DOCUMENT_PART, documentXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function loadZip(buffer: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法打开 Word 文档（不是有效的 docx 容器）：${message}`);
  }
}
