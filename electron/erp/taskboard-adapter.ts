import type { Locator, Page } from 'playwright-core';
import { ERP_REPORT_DAY_LIMIT_MINUTES, ERP_REPORT_MIN_ITEM_MINUTES, ERP_REPORT_MINUTE_STEP, isIsoDate, normalizeErpOrigin } from '../../src/erp/contracts';
import type { ErpTimeEntryInput } from '../../src/erp/runtime';

export interface ErpTimeEntryFormSnapshot {
  taskId: string;
  taskName: string;
  workDate: string;
  workMinutes: number;
  workContent: string;
}

export class ErpTimeEntrySubmissionError extends Error {
  constructor(message: string, readonly dispatched: boolean) {
    super(message);
    this.name = 'ErpTimeEntrySubmissionError';
  }
}

function validateFormInput(input: ErpTimeEntryInput): ErpTimeEntryInput {
  const origin = normalizeErpOrigin(input.origin);
  const taskId = input.taskId.trim();
  const taskName = input.taskName.trim();
  const workContent = input.workContent.trim();
  if (!/^\d{1,20}$/.test(taskId)) throw new Error('ERP 任务 ID 无效');
  if (!taskName || [...taskName].length > 200) throw new Error('ERP 任务名称无效');
  if (!isIsoDate(input.workDate)) throw new Error('ERP 报工日期无效');
  if (!Number.isInteger(input.workMinutes)
      || input.workMinutes < ERP_REPORT_MIN_ITEM_MINUTES
      || input.workMinutes > ERP_REPORT_DAY_LIMIT_MINUTES
      || input.workMinutes % ERP_REPORT_MINUTE_STEP !== 0) {
    throw new Error('ERP 报工时长无效');
  }
  if (!workContent || [...workContent].length > 2_000) throw new Error('ERP 工作内容无效');
  return { ...input, origin, taskId, taskName, workContent };
}

function dialogByTitle(page: Page, title: string | RegExp): Locator {
  return page.getByRole('dialog').filter({ has: page.locator('.el-dialog__title').filter({ hasText: title }) });
}

function formInput(dialog: Locator, label: string): Locator {
  return dialog.locator('.el-form-item').filter({ hasText: label }).locator('input').first();
}

function assertControlledOrigin(page: Page, origin: string): void {
  let current: URL;
  try {
    current = new URL(page.url());
  } catch {
    throw new Error('ERP 页面地址无效');
  }
  if (current.origin !== origin) throw new Error('ERP 页面已离开已配置站点');
}

/** 打开真实报工弹窗并填值；不会点击“确定”，提交由带写入许可的服务单独完成。 */
export async function openAndFillErpTimeEntryForm(page: Page, rawInput: ErpTimeEntryInput): Promise<ErpTimeEntryFormSnapshot> {
  const input = validateFormInput(rawInput);
  assertControlledOrigin(page, input.origin);
  const taskBlock = page.locator(`[data-task-block="${input.taskId}"]`);
  if (await taskBlock.count() !== 1) throw new Error(`无法唯一定位 ERP 任务：${input.taskName}`);

  const actualHoursCell = taskBlock.locator('.spread-cell.editable.col-hours').last();
  await actualHoursCell.scrollIntoViewIfNeeded();
  await actualHoursCell.click();

  const listDialog = dialogByTitle(page, /^工时记录：/);
  await listDialog.waitFor({ state: 'visible', timeout: 10_000 });
  const shownTitle = (await listDialog.locator('.el-dialog__title').textContent())?.trim() ?? '';
  if (shownTitle !== `工时记录：${input.taskName}`) throw new Error('ERP 打开的任务与获批任务不一致');
  await listDialog.getByRole('button', { name: /新增报工/ }).click();

  const formDialog = dialogByTitle(page, '新增报工');
  await formDialog.waitFor({ state: 'visible', timeout: 10_000 });
  const taskName = await formInput(formDialog, '任务名称').inputValue();
  if (taskName.trim() !== input.taskName) throw new Error('ERP 新增弹窗中的任务与获批任务不一致');

  const dateInput = formInput(formDialog, '日期');
  const hoursInput = formInput(formDialog, '工时');
  const contentInput = formDialog.locator('.el-form-item').filter({ hasText: '工作内容' }).locator('textarea').first();
  await dateInput.fill(input.workDate);
  await hoursInput.fill(String(input.workMinutes / 60));
  await contentInput.fill(input.workContent);
  await hoursInput.blur();

  const snapshot: ErpTimeEntryFormSnapshot = {
    taskId: input.taskId,
    taskName: (await formInput(formDialog, '任务名称').inputValue()).trim(),
    workDate: await dateInput.inputValue(),
    workMinutes: Math.round(Number(await hoursInput.inputValue()) * 60),
    workContent: (await contentInput.inputValue()).trim(),
  };
  if (snapshot.taskName !== input.taskName
      || snapshot.workDate !== input.workDate
      || snapshot.workMinutes !== input.workMinutes
      || snapshot.workContent !== input.workContent) {
    throw new Error('ERP 表单回读值与获批报工不一致');
  }
  return snapshot;
}

export async function cancelErpTimeEntryForm(page: Page): Promise<void> {
  const formDialog = dialogByTitle(page, '新增报工');
  await formDialog.getByRole('button', { name: '取 消', exact: true }).click();
  await formDialog.waitFor({ state: 'hidden', timeout: 10_000 });
}

/** 表单已经逐字段回读一致后才点击确定。点击发生后的异常一律由上层按结果未知处理。 */
export async function submitFilledErpTimeEntryForm(page: Page, originInput: string): Promise<void> {
  const origin = normalizeErpOrigin(originInput);
  assertControlledOrigin(page, origin);
  const formDialog = dialogByTitle(page, '新增报工');
  await formDialog.waitFor({ state: 'visible', timeout: 10_000 });
  const responsePromise = page.waitForResponse((response) => {
    try {
      const url = new URL(response.url());
      return url.origin === origin
        && url.pathname.endsWith('/business/time-entry')
        && response.request().method() === 'POST';
    } catch {
      return false;
    }
  }, { timeout: 15_000 });
  const [responseResult, clickResult] = await Promise.allSettled([
    responsePromise,
    formDialog.getByRole('button', { name: '确 定', exact: true }).click(),
  ]);
  const dispatched = clickResult.status === 'fulfilled';
  if (clickResult.status === 'rejected') {
    throw new ErpTimeEntrySubmissionError(clickResult.reason instanceof Error ? clickResult.reason.message : String(clickResult.reason), false);
  }
  if (responseResult.status === 'rejected') {
    throw new ErpTimeEntrySubmissionError(responseResult.reason instanceof Error ? responseResult.reason.message : String(responseResult.reason), dispatched);
  }
  const response = responseResult.value;
  if (!response.ok()) throw new ErpTimeEntrySubmissionError(`ERP 新增报工返回 HTTP ${response.status()}`, true);
  let body: unknown;
  try { body = await response.json(); } catch { throw new ErpTimeEntrySubmissionError('ERP 新增报工返回的不是 JSON', true); }
  if (!body || typeof body !== 'object' || Number((body as Record<string, unknown>).code ?? 200) !== 200) {
    throw new ErpTimeEntrySubmissionError('ERP 拒绝了新增报工', true);
  }
  try {
    await formDialog.waitFor({ state: 'hidden', timeout: 10_000 });
  } catch {
    throw new ErpTimeEntrySubmissionError('ERP 已响应成功，但新增弹窗未关闭', true);
  }
}

export async function closeErpTimeEntryList(page: Page): Promise<void> {
  const listDialog = dialogByTitle(page, /^工时记录：/);
  if (await listDialog.count() !== 1 || !await listDialog.isVisible()) return;
  await listDialog.locator('.el-dialog__headerbtn').click();
  await listDialog.waitFor({ state: 'hidden', timeout: 10_000 });
}
