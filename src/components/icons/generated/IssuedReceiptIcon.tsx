import type { IconProps } from './types';

export function IssuedReceiptIcon({ size = 16, className }: IconProps) {
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
    <path d={"M17 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"} />
    <path d={"M8.5 12.5l2.5 2.5 4.5-5"} />
    <path d={"M9 7h6"} />
    </svg>
  );
}
