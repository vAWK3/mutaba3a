import type { IconProps } from './types';

export function TaxInvoiceReceiptIcon({ size = 16, className }: IconProps) {
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
    <path d={"M19 12V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"} />
    <path d={"M13 7.5l-4 5.5"} />
    <circle cx={"9"} cy={"8"} r={"1.15"} fill={"currentColor"} stroke={"none"} />
    <circle cx={"13"} cy={"12.5"} r={"1.15"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    <path d={"M15 18.5l2 2 4-4.5"} />
    </svg>
  );
}
