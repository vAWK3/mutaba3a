import type { IconProps } from './types';

export function LinkIcon({ size = 16, className }: IconProps) {
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
    <path d={"M4.76 14.29L8.29 10.76A3.5 3.5 0 0 1 13.24 15.71L9.71 19.24A3.5 3.5 0 0 1 4.76 14.29Z"} data-part="link-a" />
    <path d={"M10.76 8.29L14.29 4.76A3.5 3.5 0 0 1 19.24 9.71L15.71 13.24A3.5 3.5 0 0 1 10.76 8.29Z"} data-part="link-b" />
    <circle cx={"16.6"} cy={"7.4"} r={"1.3"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
