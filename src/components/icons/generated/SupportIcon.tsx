import type { IconProps } from './types';

export function SupportIcon({ size = 16, className }: IconProps) {
  return (
    <svg
    width={size}
    height={size}
    viewBox={"0 0 24 24"}
    width={"24"}
    height={"24"}
    fill={"none"}
    className={className}
    >
    <rect x={"2.5"} y={"7"} width={"16"} height={"12"} rx={"2"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} />
    <path d={"M3.5 8.5l7 5 7-5"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} />
    <circle cx={"20"} cy={"5"} r={"2.5"} fill={"currentColor"} />
    </svg>
  );
}
