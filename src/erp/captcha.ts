const CAPTCHA_EXPRESSION = /^\s*(-?\d{1,3})\s*([+\-xX×*\/÷])\s*(-?\d{1,3})\s*(?:[=＝]\s*[?？]?)?\s*$/;

export interface ErpCaptchaSolution {
  expression: string;
  answer: string;
}

/** 只接受两个小整数和一个基础运算符；绝不执行模型返回的代码。 */
export function solveErpCaptchaText(value: string): ErpCaptchaSolution {
  const match = value.trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/, '').match(CAPTCHA_EXPRESSION);
  if (!match) throw new Error('验证码识别结果不是受支持的两数算式');
  const left = Number(match[1]);
  const right = Number(match[3]);
  const operator = match[2].replace(/[xX×]/, '*').replace('÷', '/');
  let result: number;
  switch (operator) {
    case '+': result = left + right; break;
    case '-': result = left - right; break;
    case '*': result = left * right; break;
    case '/':
      if (right === 0 || left % right !== 0) throw new Error('验证码除法结果不是整数');
      result = left / right;
      break;
    default: throw new Error('验证码运算符无效');
  }
  if (!Number.isSafeInteger(result) || Math.abs(result) > 100_000) throw new Error('验证码计算结果超出安全范围');
  return { expression: `${left}${operator}${right}`, answer: String(result) };
}
