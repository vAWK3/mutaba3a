import type { IconProps } from './types';

export function LanguageIcon({ size = 16, className }: IconProps) {
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
    <circle cx={"12"} cy={"12"} r={"9"} />
    <path d={"M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"} />
    <circle cx={"12"} cy={"12"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
