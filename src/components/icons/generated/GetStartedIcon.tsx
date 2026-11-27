import type { IconProps } from './types';

export function GetStartedIcon({ size = 16, className }: IconProps) {
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
    <path d={"M3 21h6v-5h6v-4h6"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} />
    <path d={"M15 12V3l5 2.5-5 2.5"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} />
    </svg>
  );
}
