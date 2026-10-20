import type { IconProps } from './types';

export function SwapHorizontalIcon({ size = 16, className }: IconProps) {
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
    <path d={"M7 7h12m0 0l-4-4m4 4l-4 4"} />
    <path d={"M17 17H5m0 0l4 4m-4-4l4-4"} />
    </svg>
  );
}
