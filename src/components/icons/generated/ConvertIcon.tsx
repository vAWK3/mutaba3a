import type { IconProps } from './types';

export function ConvertIcon({ size = 16, className }: IconProps) {
  return (
    <svg
    width={size}
    height={size}
    viewBox={"0 0 24 24"}
    fill={"none"}
    stroke={"currentColor"}
    strokeWidth={2}
    strokeLinecap={"round"}
    strokeLinejoin={"round"}
    className={className}
    >
    <path d={"M3 10a9 9 0 0 1 16.5-3.5M21 14a9 9 0 0 1-16.5 3.5M20 3v4h-4M4 21v-4h4"} />
    <circle cx={"12"} cy={"12"} r={"2"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
