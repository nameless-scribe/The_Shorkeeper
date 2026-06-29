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
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/60 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-2.5 py-1 text-[11px] transition ${
              active
                ? 'bg-keeper-cyan/25 font-medium text-keeper-cyan'
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
