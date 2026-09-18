/**
 * 流式对话消息列表的纯变换。不碰 React、IPC 与 window，便于在 node 环境直接测。
 *
 * 为什么单独一层：`useAgentEvents` 是整个聊天的中枢，但它的消息推演逻辑原先全部内联在
 * `setMessages` 的 updater 里，只能靠真实 Electron 对话验证。抽出来之后，
 * 增量拼接、工具调用状态流转、空回复丢弃这些规则可以单独锁死。
 *
 * 另一个约束：这里的函数必须是**纯**的。React StrictMode 会双调用 state updater，
 * updater 里做副作用（改 ref、发 IPC）会执行两次；只要 updater 体是纯函数，双调用就是安全的。
 */
import type { MessageInfo, WorkspaceAttachment } from '@/shared/types';
import type { UiToolCall } from '../components/ToolCallCard';
import { extractFilesFromToolCall, mergeAttachments } from '../components/file-attachment-utils';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  thinking?: boolean;
  toolCalls?: UiToolCall[];
  attachments?: WorkspaceAttachment[];
  /** 本轮工具涉及的工作区文件（用于可点击打开） */
  relatedFiles?: WorkspaceAttachment[];
  createdAt?: number;
}

export function streamIdForRun(runId: string): string {
  return `stream-${runId}`;
}

/** 已持久化的消息转 UI 消息：丢弃 system，只保留展示需要的字段。 */
export function toUiMessages(list: MessageInfo[]): UiMessage[] {
  return list
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt,
    }));
}

export function appendStreamPlaceholder(messages: UiMessage[], streamId: string, now: number): UiMessage[] {
  return [
    ...messages,
    { id: streamId, role: 'assistant', content: '', streaming: true, thinking: true, createdAt: now },
  ];
}

export function markThinking(messages: UiMessage[], streamId: string): UiMessage[] {
  return messages.map((m) => (m.id === streamId ? { ...m, thinking: true, streaming: true } : m));
}

export function appendTextDelta(messages: UiMessage[], streamId: string, delta: string): UiMessage[] {
  return messages.map((m) =>
    m.id === streamId ? { ...m, content: m.content + delta, thinking: false, streaming: true } : m,
  );
}

/** 同一 callId 重复到达时保持原样，避免重复插卡。 */
export function startToolCall(
  messages: UiMessage[],
  streamId: string,
  call: { callId: string; name: string; args: UiToolCall['args'] },
): UiMessage[] {
  return messages.map((m) => {
    if (m.id !== streamId) return m;
    const existing = m.toolCalls ?? [];
    if (existing.some((tc) => tc.callId === call.callId)) return m;
    return {
      ...m,
      thinking: false,
      streaming: true,
      toolCalls: [...existing, { callId: call.callId, name: call.name, args: call.args, status: 'running' as const }],
    };
  });
}

export function endToolCall(
  messages: UiMessage[],
  streamId: string,
  end: { callId: string; result: NonNullable<UiToolCall['result']> },
): UiMessage[] {
  return messages.map((m) => {
    if (m.id !== streamId) return m;
    const toolCalls = (m.toolCalls ?? []).map((tc) =>
      tc.callId === end.callId
        ? { ...tc, status: end.result.success ? ('done' as const) : ('error' as const), result: end.result }
        : tc,
    );
    const ended = toolCalls.find((tc) => tc.callId === end.callId);
    const relatedFiles = ended ? mergeAttachments(m.relatedFiles, extractFilesFromToolCall(ended)) : m.relatedFiles;
    return { ...m, toolCalls, relatedFiles };
  });
}

export function dropStreamingMessages(messages: UiMessage[]): UiMessage[] {
  return messages.filter((m) => !m.streaming);
}

/** 预算/必要回答停止不是成功完成，但其阶段摘要和工具证据不能被错误清理掉。 */
export function stopStream(messages: UiMessage[], streamId: string, preserveSummary: boolean): UiMessage[] {
  return preserveSummary ? finalizeStream(messages, streamId, '').messages : dropStreamingMessages(messages);
}

export interface FinalizedStream {
  messages: UiMessage[];
  /** 流式消息上累计的工具调用，供随后回填到持久化消息上 */
  toolCalls?: UiToolCall[];
  relatedFiles?: WorkspaceAttachment[];
  hasToolCalls: boolean;
}

/** 运行结束：定稿流式消息；既无正文又无工具调用的空壳直接丢弃。 */
export function finalizeStream(messages: UiMessage[], streamId: string, content: string): FinalizedStream {
  const streamMessage = messages.find((m) => m.id === streamId);
  const toolCalls = streamMessage?.toolCalls;
  const relatedFiles = streamMessage?.relatedFiles;
  const hasToolCalls = Boolean(toolCalls?.length);
  const next = messages
    .map((m) => (m.id === streamId ? { ...m, streaming: false, thinking: false, content: content || m.content } : m))
    // 按回填后的正文判断，而不是按本轮上报的 content：上报为空但消息上已有增量正文时，
    // 用后者判断能避免把用户已经看见的回复整条丢掉。
    .filter((m) => !(m.id === streamId && !m.content.trim() && !hasToolCalls));
  return { messages: next, toolCalls, relatedFiles, hasToolCalls };
}

/** 把本轮的工具调用与产物回填到最后一条助手消息上（持久化记录里不含这些运行期信息）。 */
export function attachToolArtifacts(
  messages: UiMessage[],
  artifacts: { toolCalls?: UiToolCall[]; relatedFiles?: WorkspaceAttachment[] },
): UiMessage[] {
  const { toolCalls, relatedFiles } = artifacts;
  if (!toolCalls?.length && !relatedFiles?.length) return messages;
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i].role === 'assistant') {
      next[i] = {
        ...next[i],
        ...(toolCalls?.length ? { toolCalls } : {}),
        ...(relatedFiles?.length ? { relatedFiles } : {}),
      };
      break;
    }
  }
  return next;
}

/** 最后一条有正文的助手消息；用于把流式 id 映射到持久化 id。 */
export function findLastPersistedAssistant(messages: UiMessage[]): UiMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant' && message.content.trim()) return message;
  }
  return null;
}
