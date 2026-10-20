import type { IconProps } from './types';

export function IncomeIcon({ size = 16, className }: IconProps) {
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
    <path d={"M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6M12 6v16"} />
    <circle cx={"12"} cy={"2.8"} r={"1.4"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
