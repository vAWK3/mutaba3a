import type { IconProps } from './types';

export function GuideIcon({ size = 16, className }: IconProps) {
  return (
    <svg
    width={size}
    height={size}
    viewBox={"0 0 24 24"}
    width={"24"}
    height={"24"}
    fill={"none"}
    className={className}
    >
    <path d={"M12 8.5c-2-1.6-5-2.1-8-1.5v11c3-.6 6-.1 8 1.5 2-1.6 5-2.1 8-1.5V7c-3-.6-6-.1-8 1.5zM12 8.5v11"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} />
    <path d={"M19 1.5v3M17.5 3h3"} fill={"none"} stroke={"currentColor"} strokeWidth={2} strokeLinecap={"round"} strokeLinejoin={"round"} />
    </svg>
  );
}
