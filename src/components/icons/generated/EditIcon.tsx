import type { IconProps } from './types';

export function EditIcon({ size = 16, className }: IconProps) {
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
    <path d={"M5.5 14.5L15 5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L9.5 18.5z"} data-part="body" />
    <path d={"M5.5 14.5L4 20l5.5-1.5"} data-part="tip" />
    <circle cx={"19"} cy={"20"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
