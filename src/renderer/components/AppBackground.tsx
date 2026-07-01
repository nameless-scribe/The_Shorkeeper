import { useAppearance } from '../theme/use-appearance';

interface AppBackgroundProps {
  /** chat：左侧阅读遮罩；status：居中展示角色 */
  variant?: 'chat' | 'status';
}

/**
 * 守岸人主题背景：内置立绘或用户自定义壁纸，随窗口尺寸 cover/contain 自适应
 */
export function AppBackground({ variant = 'chat' }: AppBackgroundProps) {
  const isStatus = variant === 'status';
  const appearance = useAppearance();
  const hasCustomBg = Boolean(appearance?.assets.backgroundUrl);
  const useBuiltinCompose = !hasCustomBg;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
      <div
        className={[
          'keeper-scene absolute inset-0',
          isStatus ? 'keeper-scene-status' : '',
          useBuiltinCompose ? 'keeper-scene-builtin' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />
      <div className={`absolute inset-0 ${isStatus ? 'keeper-veil-status' : 'keeper-veil'}`} />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-keeper-navyDeep/70 to-transparent" />
      {isStatus ? (
        <>
          <div className="keeper-stars-layer absolute inset-0 bg-keeper-stars animate-twinkle" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-keeper-navyDeep/90 via-keeper-navyDeep/45 to-transparent" />
        </>
      ) : (
        <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-keeper-navyDeep/80 to-transparent" />
      )}
    </div>
  );
}
