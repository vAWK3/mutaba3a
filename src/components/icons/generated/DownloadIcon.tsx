import type { IconProps } from './types';

export function DownloadIcon({ size = 16, className }: IconProps) {
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
    <path d={"M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"} data-part="tray" />
    <path d={"M12 8v7M7 10l5 5 5-5"} data-part="arrow" />
    <circle cx={"12"} cy={"4"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
