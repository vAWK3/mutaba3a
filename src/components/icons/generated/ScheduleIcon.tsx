import type { IconProps } from './types';

export function ScheduleIcon({ size = 16, className }: IconProps) {
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
    <circle cx={"12"} cy={"12"} r={"9"} data-part="face" />
    <path d={"M12 6.5V10M13.7 13.2l2.8 1.8"} data-part="hands" />
    <circle cx={"12"} cy={"12"} r={"1.7"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
