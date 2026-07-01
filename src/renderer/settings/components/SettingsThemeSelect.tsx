import type { ThemePresetSummary } from '@/shared/types';
import { SETTINGS_SELECT_CLASS } from './settings-ui';

interface SettingsThemeSelectProps {
  presets: ThemePresetSummary[];
  value: string;
  onChange: (presetId: string) => void;
}

export function SettingsThemeSelect({ presets, value, onChange }: SettingsThemeSelectProps) {
  const active = presets.find((p) => p.id === value) ?? presets[0];

  return (
    <div className="space-y-3">
      {active && (
        <div
          className="h-10 rounded-xl border border-keeper-silver/15 shadow-glow-md"
          style={{
            background: `linear-gradient(135deg, ${active.swatchDeep} 0%, ${active.swatchAccent} 100%)`,
          }}
          aria-hidden
        />
      )}

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${SETTINGS_SELECT_CLASS} cursor-pointer`}
      >
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>

      {active?.description && (
        <p className="text-[11px] leading-relaxed text-keeper-ice/50">{active.description}</p>
      )}
    </div>
  );
}
