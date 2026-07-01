interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SettingsSegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
}: SettingsSegmentedProps<T>) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-xl border border-keeper-silver/15 bg-keeper-navyDeep/50 p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs transition ${
              active
                ? 'bg-keeper-cyan/20 font-medium text-keeper-cyan shadow-inset-accent-sm'
                : 'text-keeper-ice/55 hover:text-keeper-ice/80'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
