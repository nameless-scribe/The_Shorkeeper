import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_USER_CONTRACT,
  ASK_USER_UNANSWERED_ERROR,
  askUserTool,
  parseAskUserArgs,
} from '../interaction/ask-user';
import {
  hasUserQuestionResponder,
  requestUserAnswer,
  setUserQuestionResponder,
  type UserQuestionOutcome,
} from '../../agent/user-questions';
import { createBuiltinRegistry } from '../builtin';
import { resolveToolContract } from '../contract';

const ctx = (signal = new AbortController().signal) => ({
  sessionId: 's1',
  runId: 'run-1',
  workspaceRoot: 'C:/tmp',
  signal,
});

afterEach(() => {
  setUserQuestionResponder(null);
});

describe('parseAskUserArgs', () => {
  it('normalizes a full question with options', () => {
    expect(parseAskUserArgs({
      question: ' 改哪一份？ ',
      why: '会写回文件',
      options: [
        { id: 'v1', label: '报价单-v1', hint: ' 上周的 ' },
        { id: 'v2', label: '报价单-v2' },
      ],
    })).toEqual({
      payload: {
        question: '改哪一份？',
        why: '会写回文件',
        allowFreeText: true,
        options: [
          { id: 'v1', label: '报价单-v1', hint: '上周的' },
          { id: 'v2', label: '报价单-v2' },
        ],
      },
    });
  });

  it('defaults to free text without options', () => {
    expect(parseAskUserArgs({ question: '收件人是谁？' })).toEqual({
      payload: { question: '收件人是谁？', options: [], allowFreeText: true, why: undefined },
    });
  });

  it.each([
    [{}, '缺少 question'],
    [{ question: 'x'.repeat(301) }, 'question 过长'],
    [{ question: 'q', why: 'y'.repeat(121) }, 'why 过长'],
    [{ question: 'q', options: [{ id: 'a', label: 'A' }] }, '至少 2 项'],
    [{ question: 'q', options: Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `选项 ${i}` })) }, '最多 6 项'],
    [{ question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }, '选项 id 重复'],
    [{ question: 'q', options: [{ id: 'a', label: '' }, { id: 'b', label: 'B' }] }, '非空的 id 与 label'],
    [{ question: 'q', allow_free_text: 'yes' }, '布尔值'],
    [{ question: 'q', allow_free_text: false }, '必须允许自由回答'],
  ])('rejects invalid arguments %#', (args, message) => {
    const parsed = parseAskUserArgs(args);
    expect('error' in parsed && parsed.error).toContain(message);
  });
});

describe('ask_user tool', () => {
  it('is registered as a core tool with a read-only, output-evidence contract', () => {
    const registry = createBuiltinRegistry();
    expect(registry.get('ask_user')).toBe(askUserTool);
    expect(resolveToolContract(askUserTool)).toEqual(ASK_USER_CONTRACT);
    expect(askUserTool.requiresPermission).toEqual([]);
  });

  it('returns the chosen option label and id when the user answers', async () => {
    const responder = vi.fn(async (): Promise<UserQuestionOutcome> => ({ answer: '报价单-v2', optionId: 'v2', decidedBy: 'user' }));
    setUserQuestionResponder(responder);
    expect(hasUserQuestionResponder()).toBe(true);

    const result = await askUserTool.execute(
      { question: '改哪一份？', options: [{ id: 'v1', label: '报价单-v1' }, { id: 'v2', label: '报价单-v2' }] },
      ctx(),
    );
    expect(result).toEqual({
      success: true,
      output: '用户回答：报价单-v2（选项 v2）',
      metadata: { decidedBy: 'user', optionId: 'v2' },
    });
    expect(responder).toHaveBeenCalledWith(
      expect.objectContaining({ question: '改哪一份？', allowFreeText: true }),
      expect.objectContaining({ runId: 'run-1', sessionId: 's1' }),
    );
  });

  it('returns free text answers verbatim', async () => {
    setUserQuestionResponder(async () => ({ answer: '  发给财务  ', decidedBy: 'user' }));
    const result = await askUserTool.execute({ question: '发给谁？' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toBe('用户回答：发给财务');
    expect(result.metadata).toEqual({ decidedBy: 'user' });
  });

  it.each([
    ['timeout', 'timeout'],
    ['abort', 'cancelled'],
    ['window_closed', 'cancelled'],
  ] as const)('fails with a stop instruction when the answer is %s', async (decidedBy, category) => {
    setUserQuestionResponder(async () => ({ answer: '', decidedBy }));
    const result = await askUserTool.execute({ question: '继续吗？' }, ctx());
    expect(result).toEqual({
      success: false,
      output: '',
      error: ASK_USER_UNANSWERED_ERROR,
      errorCategory: category,
      metadata: { decidedBy },
    });
  });

  it('fails closed when no responder is injected (no UI)', async () => {
    expect(hasUserQuestionResponder()).toBe(false);
    const result = await askUserTool.execute({ question: '继续吗？' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toBe(ASK_USER_UNANSWERED_ERROR);
    expect(result.metadata).toEqual({ decidedBy: 'abort' });
  });

  it('does not bother the user when the run is already cancelled', async () => {
    const responder = vi.fn(async (): Promise<UserQuestionOutcome> => ({ answer: 'x', decidedBy: 'user' }));
    setUserQuestionResponder(responder);
    const controller = new AbortController();
    controller.abort();
    const outcome = await requestUserAnswer({ question: 'q', options: [], allowFreeText: true }, { signal: controller.signal });
    expect(outcome).toEqual({ answer: '', decidedBy: 'abort' });
    expect(responder).not.toHaveBeenCalled();
  });

  it('rejects bad arguments before asking anything', async () => {
    const responder = vi.fn();
    setUserQuestionResponder(responder as never);
    const result = await askUserTool.execute({ question: '' }, ctx());
    expect(result).toMatchObject({ success: false, errorCategory: 'invalid_arguments' });
    expect(responder).not.toHaveBeenCalled();
  });
});
