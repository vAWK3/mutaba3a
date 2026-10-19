import type { IconProps } from './types';

export function DeleteIcon({ size = 16, className }: IconProps) {
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
    <path d={"M4 7h16M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"} data-part="lid" />
    <path d={"M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"} data-part="bin" />
    </svg>
  );
}
