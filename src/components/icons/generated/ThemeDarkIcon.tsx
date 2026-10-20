import type { IconProps } from './types';

export function ThemeDarkIcon({ size = 16, className }: IconProps) {
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
    <path d={"M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"} data-part="moon" />
    <circle cx={"18"} cy={"5"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
