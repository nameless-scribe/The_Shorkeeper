import { TETHYS_EMBLEM_URL } from '../public-assets';

export function SplashPage() {
  return (
    <div className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-keeper-navyDeep">
      <div className="keeper-stars-layer absolute inset-0 animate-twinkle opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% 42%, rgb(48 188 237 / 0.18) 0%, transparent 70%)',
        }}
        aria-hidden
      />

      <div className="relative z-10 flex flex-col items-center gap-5 px-8 text-center">
        <div className="splash-emblem-wrap animate-pulse-glow">
          <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl bg-white/95 p-3 shadow-[0_0_32px_rgb(48_188_237_/_0.35),inset_0_0_0_1px_rgba(255,255,255,0.2)]">
            <img
              src={TETHYS_EMBLEM_URL}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
            />
          </span>
        </div>

        <div className="splash-copy">
          <p className="text-base font-medium tracking-wide text-keeper-ice/95">
            泰缇斯终端启动中，请稍后
          </p>
        </div>

        <div className="splash-loader mt-2 flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-keeper-cyan/70"
              style={{ animation: `splashDot 1.2s ease-in-out ${i * 0.18}s infinite` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
