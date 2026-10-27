import type { Currency } from '../../../../lib/utils';
import { useCountUp } from '../../useCountUp';
import { useMockFormat } from './useMockFormat';

interface CountUpAmountProps {
  minor: number;
  currency: Currency;
}

/**
 * An amount that counts up once on load. The final value is laid out
 * invisibly underneath so the width never changes (no layout shift), and
 * screen readers get only the final value.
 */
export function CountUpAmount({ minor, currency }: CountUpAmountProps) {
  const { money } = useMockFormat();
  const live = useCountUp(minor);
  const final = money(minor, currency);

  return (
    <span className="landing-mock-amount landing-count">
      <span className="landing-count-final" aria-hidden="true">
        {final}
      </span>
      <span className="landing-count-live" aria-hidden="true">
        {money(live, currency)}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
