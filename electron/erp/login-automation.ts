import type { Page } from 'playwright-core';
import { checkVisionConfig } from '../../src/config/vision';
import { solveErpCaptchaText } from '../../src/erp/captcha';
import { askVisionModel } from '../../src/vision/bailian-vl';

const MAX_CAPTCHA_ATTEMPTS = 3;

export interface ErpLoginAutomationResult {
  submitted: boolean;
  authenticated: boolean;
  message: string;
}

async function readLoginResponse(page: Page, click: () => Promise<void>): Promise<Record<string, unknown>> {
  const [responseResult, clickResult] = await Promise.allSettled([
    page.waitForResponse((response) => {
      try {
        return new URL(response.url()).pathname.endsWith('/login') && response.request().method() === 'POST';
      } catch { return false; }
    }, { timeout: 20_000 }),
    click(),
  ]);
  if (clickResult.status === 'rejected') throw clickResult.reason;
  if (responseResult.status === 'rejected') throw responseResult.reason;
  const response = responseResult.value;
  if (!response.ok()) throw new Error(`ERP 登录返回 HTTP ${response.status()}`);
  const body = await response.json() as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('ERP 登录响应格式无效');
  return body as Record<string, unknown>;
}

async function solveCaptcha(page: Page, signal?: AbortSignal): Promise<string> {
  const vision = checkVisionConfig();
  if (!vision.ok) throw new Error(vision.reason);
  const image = page.locator('.login-code-img');
  await image.waitFor({ state: 'visible', timeout: 10_000 });
  const png = await image.screenshot({ type: 'png' });
  const response = await askVisionModel({
    images: [{ name: 'erp-captcha.png', dataUrl: `data:image/png;base64,${png.toString('base64')}` }],
    question: '只抄录图片中的两个整数和一个加减乘除运算符，严格只输出算式，例如 6*3。不要计算，不要解释；看不清就输出 UNKNOWN。',
    mode: 'read_text',
    endpoint: vision.endpoint,
    maxTokens: 30,
    timeoutMs: 15_000,
    signal,
  });
  return solveErpCaptchaText(response.answer).answer;
}

export async function tryAutomatedErpLogin(page: Page, signal?: AbortSignal): Promise<ErpLoginAutomationResult> {
  const loginButton = page.getByRole('button', { name: /登\s*录/ });
  if (await loginButton.count() !== 1) return { submitted: false, authenticated: false, message: '未找到 ERP 登录按钮，请在浏览器中人工登录' };
  const captchaImage = page.locator('.login-code-img');
  const captchaEnabled = await captchaImage.count() === 1 && await captchaImage.isVisible();
  if (!captchaEnabled) {
    const body = await readLoginResponse(page, () => loginButton.click());
    const ok = Number(body.code ?? 200) === 200;
    return { submitted: true, authenticated: ok, message: ok ? 'ERP 已自动登录' : String(body.msg ?? 'ERP 登录失败') };
  }

  const vision = checkVisionConfig();
  if (!vision.ok) return { submitted: false, authenticated: false, message: `${vision.reason}；请在专用浏览器中人工输入验证码` };
  for (let attempt = 1; attempt <= MAX_CAPTCHA_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) return { submitted: false, authenticated: false, message: 'ERP 登录已取消' };
    const previousSrc = await captchaImage.getAttribute('src');
    let answer: string;
    try {
      answer = await solveCaptcha(page, signal);
    } catch (error) {
      if (attempt === MAX_CAPTCHA_ATTEMPTS) {
        return { submitted: false, authenticated: false, message: `验证码连续 ${MAX_CAPTCHA_ATTEMPTS} 次未能可靠识别：${error instanceof Error ? error.message : String(error)}；请人工接管` };
      }
      await captchaImage.click();
      if (previousSrc) await page.waitForFunction((src) => document.querySelector<HTMLImageElement>('.login-code-img')?.src !== src, previousSrc, { timeout: 10_000 }).catch(() => undefined);
      continue;
    }
    const codeInput = page.getByPlaceholder('验证码');
    await codeInput.fill(answer);
    const body = await readLoginResponse(page, () => loginButton.click());
    if (Number(body.code ?? 200) === 200) return { submitted: true, authenticated: true, message: 'ERP 已自动识别验证码并登录' };
    const message = String(body.msg ?? 'ERP 登录失败');
    if (!/验证码/.test(message)) return { submitted: true, authenticated: false, message: `ERP 登录失败：${message}；已停止自动尝试` };
    if (attempt === MAX_CAPTCHA_ATTEMPTS) return { submitted: true, authenticated: false, message: `验证码连续 ${MAX_CAPTCHA_ATTEMPTS} 次未通过，请人工接管` };
    if (previousSrc) await page.waitForFunction((src) => document.querySelector<HTMLImageElement>('.login-code-img')?.src !== src, previousSrc, { timeout: 10_000 }).catch(() => undefined);
  }
  return { submitted: false, authenticated: false, message: '请人工完成 ERP 登录' };
}
