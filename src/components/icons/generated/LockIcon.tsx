import type { IconProps } from './types';

export function LockIcon({ size = 16, className }: IconProps) {
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
    <rect x={"4"} y={"11"} width={"16"} height={"10"} rx={"3"} data-part="body" />
    <path d={"M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11"} data-part="shackle" />
    <circle cx={"12"} cy={"16"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
