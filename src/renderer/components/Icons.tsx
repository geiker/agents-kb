import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function defaults(size: number, props: IconProps, viewBox = '0 0 16 16', strokeWidth = 1.5): SVGProps<SVGSVGElement> {
  const { size: _, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
}

export function BrainIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props)}>
      <path d="M8 14V8" />
      <path d="M4.5 9.5C3 9.5 2 8.4 2 7s1-2.5 2.5-2.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5c1.5 0 2.5 1.1 2.5 2.5s-1 2.5-2.5 2.5" />
      <path d="M5.5 12c0 1.1.9 2 2.5 2s2.5-.9 2.5-2" />
      <path d="M5.5 9.5v2.5M10.5 9.5v2.5" />
    </svg>
  );
}

export function LightbulbIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

export function SettingsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function TrashIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function XIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function BranchIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props)}>
      <line x1="6" y1="3" x2="6" y2="13" />
      <circle cx="6" cy="3" r="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7c0 3-2 4-6 6" />
    </svg>
  );
}
