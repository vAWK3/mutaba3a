import type { IconProps } from './types';

export function MatterIcon({ size = 16, className }: IconProps) {
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
    <path d={"M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"} data-part="tab" />
    <path d={"M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"} data-part="body" />
    </svg>
  );
}
