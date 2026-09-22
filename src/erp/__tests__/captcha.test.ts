import { describe, expect, it } from 'vitest';
import { solveErpCaptchaText } from '../captcha';

describe('ERP captcha arithmetic', () => {
  it.each([
    ['6 + 3 = ?', '9'],
    ['12×4', '48'],
    ['18 ÷ 3', '6'],
    ['7-9', '-2'],
  ])('evaluates only the recognized two-number expression %s', (text, answer) => {
    expect(solveErpCaptchaText(text).answer).toBe(answer);
  });

  it.each(['process.exit()', '1+2+3', '8/3', '1/0', '没有看清'])('rejects unsafe or ambiguous output: %s', (text) => {
    expect(() => solveErpCaptchaText(text)).toThrow();
  });
});
