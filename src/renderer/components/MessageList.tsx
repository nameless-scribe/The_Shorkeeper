import type { UiMessage } from '../hooks/useAgentEvents';

interface MessageListProps {
  messages: UiMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 no-drag">
      {messages.length === 0 && (
        <div className="mt-8 text-center text-sm text-keeper-ice/40">
          向 Shorekeeper 打个招呼吧
        </div>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-keeper-user text-white shadow-cyanSm'
                : 'keeper-glass-soft text-keeper-ice shadow-sm'
            }`}
          >
            <p className="whitespace-pre-wrap break-words">
              {msg.content}
              {msg.streaming && (
                <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-keeper-cyan shadow-[0_0_8px_#00D4FF]" />
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
