/**
 * 向用户提问的注入点（P6.1）。
 *
 * 与权限确认（`setPermissionConfirmer`）同一做法：`src/` 不引用 Electron，
 * 主进程在启动时注入"弹窗并等待回答"的实现；没有界面时默认回答 `abort`——
 * 不假装有答案。落库（`user_questions` 表）在 P6.2 接入本模块。
 */

import type { UserQuestionOption } from '../shared/types';
import { isDatabaseReady } from '../db/state';
import { answerUserQuestion, createUserQuestion } from '../db/repositories/user-questions';

export interface UserQuestionPayload {
  question: string;
  options: UserQuestionOption[];
  allowFreeText: boolean;
  why?: string;
}

export type UserQuestionDecider = 'user' | 'timeout' | 'abort' | 'window_closed';

export interface UserQuestionOutcome {
  /** 用户的回答原文；选项作答时为选项的 label */
  answer: string;
  optionId?: string;
  decidedBy: UserQuestionDecider;
}

export interface UserQuestionContext {
  runId?: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export type UserQuestionResponder = (
  payload: UserQuestionPayload,
  context: UserQuestionContext,
) => Promise<UserQuestionOutcome>;

const NO_UI_RESPONDER: UserQuestionResponder = async () => ({ answer: '', decidedBy: 'abort' });

let responder: UserQuestionResponder = NO_UI_RESPONDER;

export function setUserQuestionResponder(next: UserQuestionResponder | null): void {
  responder = next ?? NO_UI_RESPONDER;
}

export function hasUserQuestionResponder(): boolean {
  return responder !== NO_UI_RESPONDER;
}

/** 提问并等待。取消信号已触发时直接返回 abort，不打扰用户。 */
export async function requestUserAnswer(
  payload: UserQuestionPayload,
  context: UserQuestionContext = {},
): Promise<UserQuestionOutcome> {
  if (context.signal?.aborted) return { answer: '', decidedBy: 'abort' };

  // P6.2：有数据库时先记 pending，拿到结果再收口；账本只是证据，不能反过来阻断提问
  let questionId: string | null = null;
  if (isDatabaseReady()) {
    try {
      questionId = createUserQuestion({
        runId: context.runId ?? null,
        sessionId: context.sessionId ?? null,
        question: payload.question,
        why: payload.why ?? null,
        options: payload.options,
        allowFreeText: payload.allowFreeText,
      }).id;
    } catch (error) {
      console.warn('[ask_user] 提问记录写入失败:', error instanceof Error ? error.message : error);
    }
  }

  let outcome: UserQuestionOutcome;
  try {
    outcome = await responder(payload, context);
  } catch (error) {
    settle(questionId, { answer: '', decidedBy: context.signal?.aborted ? 'abort' : 'window_closed' });
    throw error;
  }
  const normalized: UserQuestionOutcome = outcome.decidedBy === 'user'
    ? outcome
    : { answer: '', optionId: undefined, decidedBy: outcome.decidedBy };
  settle(questionId, normalized);
  return normalized;
}

function settle(questionId: string | null, outcome: UserQuestionOutcome): void {
  if (!questionId) return;
  try {
    answerUserQuestion(questionId, {
      answer: outcome.decidedBy === 'user' ? outcome.answer : undefined,
      optionId: outcome.optionId,
      decidedBy: outcome.decidedBy,
    });
  } catch (error) {
    console.warn('[ask_user] 提问结论写入失败:', error instanceof Error ? error.message : error);
  }
}
