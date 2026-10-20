import type { IconProps } from './types';

export function UpdateIcon({ size = 16, className }: IconProps) {
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
    <rect x={"6"} y={"2"} width={"12"} height={"20"} rx={"2.5"} />
    <path d={"M12 6.5v6M9 9.5l3 3 3-3"} />
    <circle cx={"12"} cy={"18"} r={"1.3"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
