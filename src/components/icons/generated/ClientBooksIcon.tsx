import type { IconProps } from './types';

export function ClientBooksIcon({ size = 16, className }: IconProps) {
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
    <path d={"M14 18h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v1M14 7h6"} data-part="book-back" />
    <g data-part="book-front">
      <rect x={"4"} y={"6"} width={"10"} height={"15"} rx={"2"} />
      <path d={"M4 10h10"} />
    </g>
    <circle cx={"9"} cy={"15.5"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
