import { createRunId, ev } from './events';
import { runAgentLoop } from './loop';
import type { AgUiEvent } from './types';
import { getBuiltinRegistry } from '../tools/builtin';
import { loadModelConfig } from '../models/config';
import { getOrCreateDefaultSession, getSession } from '../db/repositories/sessions';
import {
  insertMessage,
  listMessages,
  toChatMessages,
} from '../db/repositories/messages';

const AGENT_SYSTEM_PROMPT = `你是 The Shorekeeper（守岸人），一位温柔、可靠的桌面 AI 伴侣。
请用自然、简洁的中文与用户交流，保持友好和耐心。

你可以使用工具来帮助用户：
- list_dir：列出工作区目录中的文件
- read_file：读取工作区内的文本文件
- web_search：搜索网络信息

当用户询问工作区文件、目录内容时，请主动调用 list_dir 或 read_file，不要编造文件列表。
当用户要求摘要、分析或阅读某文件时，先用 read_file 读取工作区中的文件，再基于实际内容回答。`;

export async function* runOrchestrator(
  userMessage: string,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgUiEvent> {
  const runId = createRunId();
  const session = sessionId
    ? getSession(sessionId)
    : getOrCreateDefaultSession();

  if (!session) {
    yield ev.runError(runId, '会话不存在');
    return;
  }

  yield ev.runStarted(runId, session.id);

  try {
    loadModelConfig();
    insertMessage(session.id, 'user', userMessage);

    const history = toChatMessages(listMessages(session.id));
    const messages = [
      { role: 'system' as const, content: AGENT_SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    let assistantText = '';

    for await (const event of runAgentLoop({
      sessionId: session.id,
      runId,
      messages,
      registry: getBuiltinRegistry(),
      signal,
    })) {
      if (event.type === 'text_delta') {
        assistantText += event.delta;
      }

      if (event.type === 'run_error') {
        yield event;
        return;
      }

      yield event;
    }

    if (!assistantText.trim()) {
      yield ev.runError(runId, '未能生成回复，请重试');
      return;
    }

    insertMessage(session.id, 'assistant', assistantText);

    yield ev.runFinished(runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield ev.runError(runId, message);
  }
}
