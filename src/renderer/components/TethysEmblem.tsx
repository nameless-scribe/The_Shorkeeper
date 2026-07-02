import { TETHYS_EMBLEM_URL } from '../public-assets';

const SIZE_CLASS = {
  xs: 'h-6 w-6 p-0.5',
  sm: 'h-8 w-8 p-1',
  md: 'h-9 w-9 p-1',
  lg: 'h-16 w-16 p-2',
} as const;

interface TethysEmblemProps {
  size?: keyof typeof SIZE_CLASS;
  className?: string;
  rounded?: 'xl' | '2xl' | 'full';
}

export function TethysEmblem({
  size = 'sm',
  className = '',
  rounded = 'xl',
}: TethysEmblemProps) {
  const radius = rounded === 'full' ? 'rounded-full' : rounded === '2xl' ? 'rounded-2xl' : 'rounded-xl';

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-white/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)] ${SIZE_CLASS[size]} ${radius} ${className}`}
    >
      <img
        src={TETHYS_EMBLEM_URL}
        alt=""
        className="h-full w-full object-contain"
        draggable={false}
      />
    </span>
  );
}
