import type { ReactNode } from 'react';

export const SETTINGS_INPUT_CLASS =
  'no-drag w-full rounded-xl border border-keeper-silver/15 bg-keeper-navyDeep/50 px-3 py-2.5 text-sm text-keeper-ice outline-none transition placeholder:text-keeper-ice/30 focus:border-keeper-cyan/45 focus:ring-2 focus:ring-keeper-cyan/10';

export const SETTINGS_TEXTAREA_CLASS = `${SETTINGS_INPUT_CLASS} resize-none`;

export const SETTINGS_SELECT_CLASS = SETTINGS_INPUT_CLASS;

export function SettingsPageShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl space-y-5 pb-2">{children}</div>;
}

export function SettingsIntro({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-keeper-cyan/15 bg-gradient-to-r from-keeper-cyan/8 via-transparent to-violet-500/5 px-4 py-3">
      <p className="text-xs leading-relaxed text-keeper-ice/70">{children}</p>
    </div>
  );
}

export function SettingsSection({
  title,
  hint,
  action,
  children,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {title && (
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-keeper-ice">{title}</h3>
            {hint && <p className="mt-0.5 text-[11px] text-keeper-ice/45">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingsPanel({
  title,
  subtitle,
  icon,
  badge,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="keeper-glass-soft overflow-hidden rounded-2xl border border-keeper-silver/15">
      <div className="border-b border-keeper-ice/8 bg-keeper-navyDeep/40 px-4 py-3">
        <div className="flex items-center gap-3">
          {icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-keeper-cyan/15 text-base">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-keeper-ice">{title}</p>
            {subtitle && <p className="text-[11px] text-keeper-ice/45">{subtitle}</p>}
          </div>
          {badge}
        </div>
      </div>
      <div className="space-y-4 p-4">{children}</div>
      {footer && (
        <div className="border-t border-keeper-ice/8 bg-keeper-navyDeep/25 px-4 py-3">{footer}</div>
      )}
    </div>
  );
}

export function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-keeper-ice/75">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-relaxed text-keeper-ice/40">{hint}</span>}
    </label>
  );
}

export function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-keeper-silver/10 bg-keeper-navyDeep/30 px-3 py-2.5">
      <span className="text-sm text-keeper-ice/85">{label}</span>
      {children}
    </div>
  );
}

export function SettingsPrimaryButton({
  children,
  disabled,
  onClick,
  className = '',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl bg-gradient-to-r from-keeper-cyan/30 to-keeper-cyan/15 py-2.5 text-sm font-medium text-keeper-cyan shadow-[0_0_20px_rgba(0,212,255,0.08)] transition hover:from-keeper-cyan/40 hover:to-keeper-cyan/20 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function SettingsSecondaryButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border border-keeper-silver/20 px-4 py-2.5 text-sm text-keeper-ice/70 transition hover:border-keeper-silver/35 hover:bg-white/5 hover:text-keeper-ice ${className}`}
    >
      {children}
    </button>
  );
}

export function SettingsDangerButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border border-red-400/20 px-4 py-2.5 text-sm text-red-300/75 transition hover:border-red-400/40 hover:bg-red-950/25 ${className}`}
    >
      {children}
    </button>
  );
}

export function SettingsChip({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-keeper-cyan/40 bg-keeper-cyan/15 text-keeper-cyan'
          : 'border-keeper-cyan/20 text-keeper-ice/65 hover:border-keeper-cyan/35 hover:text-keeper-ice'
      }`}
    >
      {children}
    </button>
  );
}

export function SettingsBadge({
  children,
  tone = 'cyan',
}: {
  children: ReactNode;
  tone?: 'cyan' | 'green' | 'amber' | 'muted';
}) {
  const tones = {
    cyan: 'bg-keeper-cyan/20 text-keeper-cyan',
    green: 'bg-emerald-500/15 text-emerald-300',
    amber: 'bg-amber-500/15 text-amber-200',
    muted: 'bg-keeper-silver/15 text-keeper-ice/55',
  };
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function SettingsListCard({
  title,
  subtitle,
  meta,
  badge,
  dimmed,
  actions,
  onClick,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: ReactNode;
  dimmed?: boolean;
  actions?: ReactNode;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`keeper-glass-soft w-full rounded-2xl border border-keeper-silver/12 p-3 text-left transition ${
        dimmed ? 'opacity-55' : ''
      } ${onClick ? 'hover:border-keeper-cyan/30 hover:bg-keeper-cyan/5' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-keeper-ice">{title}</p>
            {badge}
          </div>
          {subtitle && <p className="mt-1 text-xs leading-relaxed text-keeper-ice/55">{subtitle}</p>}
          {meta && <p className="mt-1 text-[10px] text-keeper-ice/35">{meta}</p>}
        </div>
        {actions}
      </div>
    </Wrapper>
  );
}

export function SettingsActionLink({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs transition ${
        danger
          ? 'text-red-300/70 hover:text-red-300'
          : 'text-keeper-ice/55 hover:text-keeper-cyan'
      }`}
    >
      {children}
    </button>
  );
}

export function SettingsEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-keeper-silver/20 bg-keeper-navyDeep/30 px-4 py-8 text-center">
      <p className="text-sm text-keeper-ice/50">{title}</p>
      {hint && <p className="mt-1 text-xs text-keeper-ice/35">{hint}</p>}
    </div>
  );
}

export function SettingsLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 animate-pulse">
      <div className="h-14 rounded-2xl bg-keeper-silver/10" />
      <div className="h-32 rounded-2xl bg-keeper-silver/10" />
      <div className="h-48 rounded-2xl bg-keeper-silver/10" />
    </div>
  );
}

export function SettingsErrorBanner({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-red-400/25 bg-red-950/30 px-3 py-2 text-xs text-red-200">
      {message}
    </p>
  );
}

export function SettingsInlineActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}
