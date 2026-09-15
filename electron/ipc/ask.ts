/**
 * ask_user 的主进程实现（P6.1）：镜像 permission.ts。
 * pending 表、超时、abort 与窗口关闭监听、`ask:request` 推送、`ask:respond` 处理。
 * 超时 10 分钟，比权限确认长——回答问题可能需要用户去查资料。
 */

import { randomUUID } from 'node:crypto';
import { trustedIpcMain as ipcMain } from './trusted-ipc';
import type { UserQuestionRequestPayload } from '../../src/shared/types';
import type {
  UserQuestionContext,
  UserQuestionOutcome,
  UserQuestionPayload,
} from '../../src/agent/user-questions';
import { getWindowManager } from '../windows/manager';
import { sendWhenWebContentsReady } from '../windows/web-contents';
import { parseUserQuestionResponse } from '../../src/shared/ipc-validation';

interface PendingQuestion {
  payload: UserQuestionPayload;
  resolve: (outcome: UserQuestionOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
  removeWindowListener?: () => void;
  cancelPendingSend?: () => void;
}

const pending = new Map<string, PendingQuestion>();

export const USER_QUESTION_TIMEOUT_MS = 10 * 60 * 1000;

function settleQuestion(requestId: string, outcome: UserQuestionOutcome): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.removeAbortListener?.();
  entry.removeWindowListener?.();
  entry.cancelPendingSend?.();
  pending.delete(requestId);
  entry.resolve(outcome);
}

export function cancelAllPendingQuestions(): void {
  for (const requestId of pending.keys()) {
    settleQuestion(requestId, { answer: '', decidedBy: 'abort' });
  }
}

export function pendingQuestionCount(): number {
  return pending.size;
}

export async function requestUserAnswerViaWindow(
  payload: UserQuestionPayload,
  context: UserQuestionContext,
): Promise<UserQuestionOutcome> {
  const signal = context.signal;
  if (signal?.aborted) return { answer: '', decidedBy: 'abort' };

  const requestId = randomUUID();
  const chatWin = getWindowManager().show('chat');

  return new Promise((resolve) => {
    const timer = setTimeout(
      () => settleQuestion(requestId, { answer: '', decidedBy: 'timeout' }),
      USER_QUESTION_TIMEOUT_MS,
    );
    const onAbort = () => settleQuestion(requestId, { answer: '', decidedBy: 'abort' });
    const onWindowClosed = () => settleQuestion(requestId, { answer: '', decidedBy: 'window_closed' });
    const removeAbortListener = signal
      ? () => signal.removeEventListener('abort', onAbort)
      : undefined;
    const removeWindowListener = () => chatWin.removeListener('closed', onWindowClosed);
    pending.set(requestId, { payload, resolve, timer, removeAbortListener, removeWindowListener });
    signal?.addEventListener('abort', onAbort, { once: true });
    chatWin.once('closed', onWindowClosed);
    if (signal?.aborted) onAbort();

    const request: UserQuestionRequestPayload = {
      requestId,
      question: payload.question,
      options: payload.options,
      allowFreeText: payload.allowFreeText,
      ...(payload.why ? { why: payload.why } : {}),
    };
    if (pending.has(requestId)) {
      pending.get(requestId)!.cancelPendingSend = sendWhenWebContentsReady(
        chatWin.webContents,
        'ask:request',
        request,
      );
    }
  });
}

export function registerAskIpc(): void {
  ipcMain.handle('ask:respond', (_event, rawPayload: unknown) => {
    const response = parseUserQuestionResponse(rawPayload);
    const entry = pending.get(response.requestId);
    if (!entry) return { ok: false, reason: 'unknown_request' };

    if (response.dismissed) {
      settleQuestion(response.requestId, { answer: '', decidedBy: 'abort' });
      return { ok: true };
    }
    if (response.optionId) {
      const option = entry.payload.options.find((item) => item.id === response.optionId);
      if (!option) return { ok: false, reason: 'unknown_option' };
      settleQuestion(response.requestId, { answer: option.label, optionId: option.id, decidedBy: 'user' });
      return { ok: true };
    }
    const answer = response.answer?.trim() ?? '';
    if (!answer) return { ok: false, reason: 'empty_answer' };
    if (!entry.payload.allowFreeText) return { ok: false, reason: 'free_text_not_allowed' };
    settleQuestion(response.requestId, { answer, decidedBy: 'user' });
    return { ok: true };
  });
}
