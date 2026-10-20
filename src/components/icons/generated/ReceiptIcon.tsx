import type { IconProps } from './types';

export function ReceiptIcon({ size = 16, className }: IconProps) {
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
    <path d={"M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21z"} data-part="paper" />
    <path d={"M9 8h6M9 12h6M9 16h2"} data-part="lines" />
    <circle cx={"15"} cy={"16"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
