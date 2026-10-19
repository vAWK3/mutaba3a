import type { IconProps } from './types';

export function ExternalLinkIcon({ size = 16, className }: IconProps) {
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
    <path d={"M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"} data-part="box" />
    <path d={"M14 3h7v7M21 3l-7 7"} data-part="arrow" />
    <circle cx={"11.3"} cy={"12.7"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
