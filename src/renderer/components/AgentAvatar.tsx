const AVATAR_SRC = '/keeper-avatar.png';

interface AgentAvatarProps {
  size?: 'sm' | 'md';
  className?: string;
}

const sizeMap = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
};

export function AgentAvatar({ size = 'md', className = '' }: AgentAvatarProps) {
  return (
    <div
      className={`${sizeMap[size]} shrink-0 overflow-hidden rounded-full border-2 border-keeper-cyan/40 shadow-cyanSm ${className}`}
    >
      <img
        src={AVATAR_SRC}
        alt="Shorekeeper"
        className="h-full w-full object-cover object-top"
        draggable={false}
      />
    </div>
  );
}
