/**
 * 守岸人主题背景：使用 public/keeper-bg.png 全幅立绘
 */
export function AppBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
      <div className="keeper-scene absolute inset-0" />
      <div className="keeper-veil absolute inset-0" />
      {/* 顶部轻遮罩，顶栏更清晰 */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-keeper-navyDeep/70 to-transparent" />
      {/* 底部轻遮罩，输入框更清晰 */}
      <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-keeper-navyDeep/80 to-transparent" />
    </div>
  );
}
