import type { IconProps } from './types';

export function CreditNoteIcon({ size = 16, className }: IconProps) {
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
    <path d={"M17 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"} />
    <path d={"M10.5 9.5H13a2.75 2.75 0 0 1 0 5.5H9.5"} />
    <path d={"M12 7.5l-2 2 2 2"} />
    </svg>
  );
}
