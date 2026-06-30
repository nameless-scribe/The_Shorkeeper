import { useEffect, useLayoutEffect, useRef } from 'react';
import { AgentAvatar } from './AgentAvatar';
import { UserAvatar } from './UserAvatar';
import { ToolCallCard } from './ToolCallCard';
import { FileAttachmentCard } from './FileAttachmentCard';
import { collectMessageFiles } from './file-attachment-utils';
import type { UiMessage } from '../hooks/useAgentEvents';

interface MessageListProps {
  messages: UiMessage[];
  loading?: boolean;
}

function formatTime(ts?: number) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const SCROLL_PIN_THRESHOLD = 80;

export function MessageList({ messages, loading = false }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const prevMessageCountRef = useRef(messages.length);

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = distanceFromBottom <= SCROLL_PIN_THRESHOLD;
  };

  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      const last = messages[messages.length - 1];
      if (last?.role === 'user') {
        pinnedToBottomRef.current = true;
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  useLayoutEffect(() => {
    if (!pinnedToBottomRef.current) return;
    scrollToBottom();
  }, [messages]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3 no-drag"
    >
      {loading && messages.length === 0 && (
        <div className="mt-8 text-center text-sm text-keeper-ice/40">加载消息中…</div>
      )}
      {!loading && messages.length === 0 && (
        <div className="mt-8 text-center text-sm text-keeper-ice/40">
          向 Shorekeeper 打个招呼吧
        </div>
      )}
      {messages.map((msg) => {
        const hasRunningTools = msg.toolCalls?.some((tc) => tc.status === 'running');
        const showTextBubble =
          Boolean(msg.content) || (msg.thinking && !hasRunningTools);
        const outputFiles =
          msg.role === 'assistant' ? collectMessageFiles(msg) : [];

        return msg.role === 'user' ? (
          <div key={msg.id} className="flex flex-col items-end gap-1">
            <div className="flex items-start justify-end gap-2.5">
              <div className="flex max-w-[78%] flex-col items-end gap-2">
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {msg.attachments.map((file) => (
                      <FileAttachmentCard
                        key={file.relativePath}
                        file={file}
                        align="right"
                      />
                    ))}
                  </div>
                )}
                {msg.content && (
                  <div className="rounded-2xl rounded-tr-md bg-keeper-user px-4 py-2.5 text-sm leading-relaxed text-white shadow-cyanSm">
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                )}
              </div>
              <UserAvatar size="md" className="mt-0.5" />
            </div>
            {msg.createdAt && (
              <span className="pr-12 text-[10px] text-keeper-ice/35">{formatTime(msg.createdAt)}</span>
            )}
          </div>
        ) : (
          <div key={msg.id} className="flex items-start gap-2.5">
            <AgentAvatar size="md" className="mt-0.5" />
            <div className="flex min-w-0 max-w-[78%] flex-col gap-1.5">
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {msg.toolCalls.map((tc) => (
                    <ToolCallCard key={tc.callId} toolCall={tc} />
                  ))}
                </div>
              )}
              {outputFiles.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="pl-0.5 text-[10px] font-medium uppercase tracking-wide text-keeper-cyan/70">
                    相关文件
                  </p>
                  <div className="flex flex-col gap-2">
                    {outputFiles.map((file) => (
                      <FileAttachmentCard key={file.relativePath} file={file} />
                    ))}
                  </div>
                </div>
              )}
              {showTextBubble && (
                <div className="keeper-glass-soft rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed text-keeper-ice shadow-sm">
                  {msg.thinking && !msg.content ? (
                    <span className="inline-flex items-center gap-2 text-keeper-ice/60">
                      思考中
                      <span className="inline-flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-keeper-cyan shadow-[0_0_6px_#30BCED]"
                            style={{ animationDelay: `${i * 160}ms` }}
                          />
                        ))}
                      </span>
                    </span>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">
                      {msg.content}
                      {msg.streaming && (
                        <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-keeper-cyan shadow-[0_0_8px_#30BCED]" />
                      )}
                    </p>
                  )}
                </div>
              )}
              {msg.createdAt && !msg.streaming && (
                <span className="pl-1 text-[10px] text-keeper-ice/35">{formatTime(msg.createdAt)}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
