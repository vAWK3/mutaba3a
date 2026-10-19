import type { IconProps } from './types';

export function TagIcon({ size = 16, className }: IconProps) {
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
    <path d={"M12.6 3H5a2 2 0 0 0-2 2v7.6a2 2 0 0 0 .6 1.4l7.4 7.4a2 2 0 0 0 2.8 0l6.6-6.6a2 2 0 0 0 0-2.8L14 3.6a2 2 0 0 0-1.4-.6z"} />
    <circle cx={"7.8"} cy={"7.8"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
