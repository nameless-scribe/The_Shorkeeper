import { AgentAvatar } from './AgentAvatar';
import { UserAvatar } from './UserAvatar';
import type { UiMessage } from '../hooks/useAgentEvents';

interface MessageListProps {
  messages: UiMessage[];
}

function formatTime(ts?: number) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3 no-drag">
      {messages.length === 0 && (
        <div className="mt-8 text-center text-sm text-keeper-ice/40">
          向 Shorekeeper 打个招呼吧
        </div>
      )}
      {messages.map((msg) =>
        msg.role === 'user' ? (
          <div key={msg.id} className="flex flex-col items-end gap-1">
            <div className="flex items-start justify-end gap-2.5">
              <div className="max-w-[78%] rounded-2xl rounded-tr-md bg-keeper-user px-4 py-2.5 text-sm leading-relaxed text-white shadow-cyanSm">
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
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
            <div className="flex min-w-0 max-w-[78%] flex-col gap-1">
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
              {msg.createdAt && !msg.streaming && (
                <span className="pl-1 text-[10px] text-keeper-ice/35">{formatTime(msg.createdAt)}</span>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
