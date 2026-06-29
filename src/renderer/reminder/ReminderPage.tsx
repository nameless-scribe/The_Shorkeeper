import { AppBackground } from '../components/AppBackground';
import { PanelTitleBar } from '../components/PanelTitleBar';

function readQuery(key: string): string {
  const raw = new URLSearchParams(window.location.search).get(key) ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function ReminderPage() {
  const title = readQuery('title') || '守岸人提醒';
  const body = readQuery('body') || '';

  return (
    <div className="relative h-screen overflow-hidden rounded-3xl border border-keeper-cyan/40 shadow-cyan">
      <AppBackground />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <PanelTitleBar title="定时提醒" subtitle={title} />

        <div className="flex flex-1 flex-col justify-between px-5 py-5">
          <div className="keeper-glass-soft rounded-2xl px-4 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-keeper-ice">{body}</p>
          </div>

          <button
            type="button"
            onClick={() => window.shorekeeper.window.close()}
            className="no-drag mt-4 w-full rounded-2xl bg-keeper-cyan py-3 text-sm font-semibold text-keeper-navyDeep shadow-cyanSm transition hover:bg-keeper-cyanDim"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
