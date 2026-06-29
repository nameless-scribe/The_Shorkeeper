import type { UiMessage } from '../hooks/useAgentEvents';

interface MessageListProps {
  messages: UiMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 no-drag">
      {messages.length === 0 && (
        <div className="mt-8 text-center text-sm text-white/40">
          向 Shorekeeper 打个招呼吧
        </div>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-lg ${
              msg.role === 'user'
                ? 'bg-shore-accent/90 text-white'
                : 'border border-white/10 bg-white/10 text-white/95 backdrop-blur-md'
            }`}
          >
            <p className="whitespace-pre-wrap break-words">
              {msg.content}
              {msg.streaming && (
                <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-shore-glow" />
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
