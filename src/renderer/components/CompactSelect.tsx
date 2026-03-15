import { useState, useRef, useEffect } from 'react';

interface CompactSelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface CompactSelectProps<T extends string> {
  options: CompactSelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function CompactSelect<T extends string>({
  options,
  value,
  onChange,
}: CompactSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open]);

  const hasDescriptions = options.some((o) => o.description);

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`
          flex items-center gap-1.5 pl-3 pr-2 py-[5px] rounded-lg border text-[12px] font-medium
          transition-all duration-100
          ${open
            ? 'border-chrome-focus/70 bg-surface-tertiary/60 text-content-primary shadow-sm'
            : 'border-chrome/50 bg-surface-tertiary/25 text-content-secondary hover:border-chrome/80 hover:bg-surface-tertiary/45 hover:text-content-primary'
          }
        `}
      >
        <span className="leading-none">{selected?.label ?? value}</span>
        <svg
          className={`w-3 h-3 opacity-40 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={`
            absolute right-0 top-full mt-1 z-50
            ${hasDescriptions ? 'min-w-[240px]' : 'min-w-[130px]'} py-1
            rounded-lg border border-chrome/50
            bg-surface-elevated shadow-lg shadow-surface-overlay/12
            animate-[dialogIn_100ms_ease-out]
          `}
        >
          {options.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`
                  w-full flex items-center justify-between px-3 py-[6px] text-left
                  transition-colors duration-75
                  ${isActive
                    ? 'text-content-primary bg-selected-bg/60'
                    : 'text-content-secondary hover:text-content-primary hover:bg-surface-tertiary/50'
                  }
                `}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className={`text-[12px] leading-none ${isActive ? 'font-medium' : ''}`}>
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span className="text-[10px] leading-tight text-content-tertiary truncate">
                      {opt.description}
                    </span>
                  )}
                </div>
                {isActive && (
                  <svg className="w-[10px] h-[10px] shrink-0 ml-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 5.5L4 7.5L8 3" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
