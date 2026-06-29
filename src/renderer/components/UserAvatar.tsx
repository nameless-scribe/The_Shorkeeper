const AVATAR_SRC = '/user-avatar.png';

interface UserAvatarProps {
  size?: 'sm' | 'md';
  className?: string;
}

const sizeMap = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
};

export function UserAvatar({ size = 'md', className = '' }: UserAvatarProps) {
  return (
    <div
      className={`${sizeMap[size]} shrink-0 overflow-hidden rounded-full border-2 border-keeper-silver/30 shadow-cyanSm ${className}`}
    >
      <img
        src={AVATAR_SRC}
        alt="User"
        className="h-full w-full object-cover object-[70%_20%] scale-110"
        draggable={false}
      />
    </div>
  );
}
