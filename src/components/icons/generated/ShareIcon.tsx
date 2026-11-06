import type { IconProps } from './types';

export function ShareIcon({ size = 16, className }: IconProps) {
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
    <path d={"M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"} data-part="box" />
    <path d={"M12 3v11M8 7l4-4 4 4"} data-part="arrow" />
    <circle cx={"12"} cy={"17.6"} r={"1.4"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
