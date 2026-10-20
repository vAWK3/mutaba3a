import type { IconProps } from './types';

export function ThemeSystemIcon({ size = 16, className }: IconProps) {
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
    <rect x={"2"} y={"4"} width={"20"} height={"13"} rx={"3"} data-part="screen" />
    <path d={"M8 21h8M12 17v4"} data-part="stand" />
    <circle cx={"12"} cy={"10.5"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
