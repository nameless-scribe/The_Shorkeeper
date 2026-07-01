import { KEEPER_AVATAR_URL } from '../public-assets';
import { getLatestAppearance, getResolvedKeeperAvatarSrc } from '../theme/apply-theme';
import { useAppearance } from '../theme/use-appearance';

interface AgentAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
};

export function AgentAvatar({ size = 'md', className = '' }: AgentAvatarProps) {
  const appearance = useAppearance();
  const src = appearance
    ? getResolvedKeeperAvatarSrc(appearance)
    : getLatestAppearance()
      ? getResolvedKeeperAvatarSrc(getLatestAppearance()!)
      : KEEPER_AVATAR_URL;

  return (
    <div
      className={`${sizeMap[size]} shrink-0 overflow-hidden rounded-full border-2 border-keeper-cyan/40 shadow-cyanSm ${className}`}
    >
      <img
        src={src}
        alt="Agent"
        className="h-full w-full object-cover object-top"
        draggable={false}
      />
    </div>
  );
}
