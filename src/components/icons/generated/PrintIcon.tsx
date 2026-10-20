import type { IconProps } from './types';

export function PrintIcon({ size = 16, className }: IconProps) {
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
    <path d={"M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"} data-part="tray" />
    <g data-part="paper">
      <path d={"M6 8V3h12v5"} />
      <rect x={"6"} y={"14"} width={"12"} height={"7"} rx={"1.5"} />
    </g>
    <circle cx={"18"} cy={"11.5"} r={"1.2"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
