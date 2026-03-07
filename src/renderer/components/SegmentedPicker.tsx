interface SegmentedPickerOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedPickerProps<T extends string> {
  options: SegmentedPickerOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedPicker<T extends string>({
  options,
  value,
  onChange,
}: SegmentedPickerProps<T>) {
  return (
    <div className="flex shrink-0 rounded-lg border border-chrome/60 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-1 text-[12px] font-medium transition-colors ${
            value === opt.value
              ? 'bg-btn-primary text-content-inverted'
              : 'bg-surface-tertiary/30 text-content-secondary hover:bg-surface-tertiary/60'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
