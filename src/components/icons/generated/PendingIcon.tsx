import type { IconProps } from './types';

export function PendingIcon({ size = 16, className }: IconProps) {
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
    <path d={"M6 2h12M6 22h12M7 2v3.5a5 5 0 0 0 2.5 4.3L12 12l2.5-2.2A5 5 0 0 0 17 5.5V2M7 22v-3.5a5 5 0 0 1 2.5-4.3L12 12l2.5 2.2a5 5 0 0 1 2.5 4.3V22"} data-part="glass" />
    <circle cx={"12"} cy={"18.3"} r={"1.7"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
