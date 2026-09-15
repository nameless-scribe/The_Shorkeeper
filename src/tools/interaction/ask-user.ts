/**
 * ask_user（P6.1）：证据不足时向用户提一个问题，暂停运行直到拿到回答。
 *
 * 它不写任何领域数据；超时、取消、窗口关闭时返回失败，模型按【证据不足先问】的规则
 * 停下并说明"这一步需要你的回答"，不得自行假设。高风险动作仍走权限确认，本工具不能代替。
 */

import type { UserQuestionOption } from '../../shared/types';
import { requestUserAnswer, type UserQuestionPayload } from '../../agent/user-questions';
import type { ToolDefinition, ToolResult, ToolSideEffectContract } from '../types';

export const ASK_USER_TOOL_NAME = 'ask_user';
export const ASK_USER_QUESTION_MAX_CHARS = 300;
export const ASK_USER_WHY_MAX_CHARS = 120;
export const ASK_USER_OPTION_LABEL_MAX_CHARS = 80;
export const ASK_USER_OPTION_HINT_MAX_CHARS = 120;
export const ASK_USER_MIN_OPTIONS = 2;
export const ASK_USER_MAX_OPTIONS = 6;
export const ASK_USER_UNANSWERED_ERROR = '这一步需要你的回答（未收到）';

/**
 * 只读、无副作用、证据是输出本身。契约测试要求只读工具幂等：同一问题再问一次不会"多做"什么，
 * 幂等在这里是成立的（P6 计划 §9.2 写的 idempotent:false 与该约束冲突，以契约测试为准）。
 */
export const ASK_USER_CONTRACT: ToolSideEffectContract = {
  risk: 'read',
  idempotent: true,
  supportsPreview: false,
  reversible: 'none',
  evidence: 'output',
};

interface RawOption {
  id?: unknown;
  label?: unknown;
  hint?: unknown;
}

function invalid(message: string): ToolResult {
  return { success: false, output: '', error: message, errorCategory: 'invalid_arguments' };
}

/** 参数校验（纯函数，测试直接覆盖）：返回可发送的问题载荷或错误文案。 */
export function parseAskUserArgs(args: unknown): { payload: UserQuestionPayload } | { error: string } {
  const input = (args ?? {}) as {
    question?: unknown;
    options?: unknown;
    allow_free_text?: unknown;
    why?: unknown;
  };
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) return { error: '缺少 question：要问用户什么' };
  if ([...question].length > ASK_USER_QUESTION_MAX_CHARS) {
    return { error: `question 过长（上限 ${ASK_USER_QUESTION_MAX_CHARS} 字）；一次只问一个问题` };
  }

  let why: string | undefined;
  if (input.why != null) {
    if (typeof input.why !== 'string') return { error: 'why 须为字符串' };
    why = input.why.trim() || undefined;
    if (why && [...why].length > ASK_USER_WHY_MAX_CHARS) {
      return { error: `why 过长（上限 ${ASK_USER_WHY_MAX_CHARS} 字）` };
    }
  }

  const allowFreeText = input.allow_free_text === undefined ? true : input.allow_free_text === true;
  if (input.allow_free_text !== undefined && typeof input.allow_free_text !== 'boolean') {
    return { error: 'allow_free_text 须为布尔值' };
  }

  const options: UserQuestionOption[] = [];
  if (input.options !== undefined) {
    if (!Array.isArray(input.options)) return { error: 'options 须为数组' };
    if (input.options.length !== 0 && input.options.length < ASK_USER_MIN_OPTIONS) {
      return { error: `options 至少 ${ASK_USER_MIN_OPTIONS} 项，或者不给选项` };
    }
    if (input.options.length > ASK_USER_MAX_OPTIONS) {
      return { error: `options 最多 ${ASK_USER_MAX_OPTIONS} 项` };
    }
    const seen = new Set<string>();
    for (const raw of input.options as RawOption[]) {
      const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
      const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
      if (!id || !label) return { error: '每个选项须包含非空的 id 与 label' };
      if (id.length > 40) return { error: `选项 id 过长：${id.slice(0, 20)}…` };
      if ([...label].length > ASK_USER_OPTION_LABEL_MAX_CHARS) {
        return { error: `选项 label 过长（上限 ${ASK_USER_OPTION_LABEL_MAX_CHARS} 字）：${id}` };
      }
      if (seen.has(id)) return { error: `选项 id 重复：${id}` };
      seen.add(id);
      let hint: string | undefined;
      if (raw.hint != null) {
        if (typeof raw.hint !== 'string') return { error: `选项 hint 须为字符串：${id}` };
        hint = raw.hint.trim() || undefined;
        if (hint && [...hint].length > ASK_USER_OPTION_HINT_MAX_CHARS) {
          return { error: `选项 hint 过长（上限 ${ASK_USER_OPTION_HINT_MAX_CHARS} 字）：${id}` };
        }
      }
      options.push(hint ? { id, label, hint } : { id, label });
    }
  }

  if (!options.length && !allowFreeText) {
    return { error: '没有选项时必须允许自由回答（allow_free_text）' };
  }

  return { payload: { question, options, allowFreeText, why } };
}

export const askUserTool: ToolDefinition = {
  name: ASK_USER_TOOL_NAME,
  description:
    '证据不足、且歧义会改变结果或副作用时，向用户提一个问题并等待回答。一次只问一个问题，尽量给 2–4 个选项并说明为什么需要；先用 recall_memory 与已知信息找答案，找得到的不问。回答未收到时必须停下，不得自行假设。',
  category: 'skill',
  requiresPermission: [],
  sideEffects: ASK_USER_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: `要问的问题，${ASK_USER_QUESTION_MAX_CHARS} 字以内，只问一件事`,
      },
      options: {
        type: 'array',
        description: `可选项，${ASK_USER_MIN_OPTIONS}–${ASK_USER_MAX_OPTIONS} 项；界面上会额外提供"其他"供用户自由输入`,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '选项标识，返回时原样给你' },
            label: { type: 'string', description: '给用户看的选项文字' },
            hint: { type: 'string', description: '可选，一句话说明这个选项意味着什么' },
          },
          required: ['id', 'label'],
        },
      },
      allow_free_text: {
        type: 'boolean',
        description: '是否允许用户不选选项、直接输入文字，默认 true',
      },
      why: {
        type: 'string',
        description: `一句话说明为什么需要这个信息（${ASK_USER_WHY_MAX_CHARS} 字以内），会展示给用户`,
      },
    },
    required: ['question'],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const parsed = parseAskUserArgs(args);
    if ('error' in parsed) return invalid(parsed.error);

    const outcome = await requestUserAnswer(parsed.payload, {
      runId: ctx.runId,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    });

    if (outcome.decidedBy !== 'user') {
      return {
        success: false,
        output: '',
        error: ASK_USER_UNANSWERED_ERROR,
        errorCategory: outcome.decidedBy === 'timeout' ? 'timeout' : 'cancelled',
        metadata: { decidedBy: outcome.decidedBy },
      };
    }

    const answer = outcome.answer.trim();
    return {
      success: true,
      output: outcome.optionId ? `用户回答：${answer}（选项 ${outcome.optionId}）` : `用户回答：${answer}`,
      metadata: { decidedBy: 'user', ...(outcome.optionId ? { optionId: outcome.optionId } : {}) },
    };
  },
};
