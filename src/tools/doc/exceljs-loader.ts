/** exceljs 为 CJS；ESM 动态 import 时 Workbook 在 default 上 */
export async function loadExcelJS(): Promise<typeof import('exceljs')> {
  const mod = await import('exceljs');
  return (mod as { default?: typeof import('exceljs') }).default ?? mod;
}
