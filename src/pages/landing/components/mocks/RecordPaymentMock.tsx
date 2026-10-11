import { useT } from '../../../../lib/i18n';
import { SAMPLE_PAYMENT } from '../../sampleData';
import { useMockFormat } from './useMockFormat';

/**
 * The payment drawer as it opens: amount left and today's date already filled
 * in, so the second tap records it. Labels are the app's own, so the chapter's
 * "two taps" claim stays tied to the real button.
 */
export function RecordPaymentMock() {
  const t = useT();
  const { money } = useMockFormat();
  const action = t('transactions.partialPayment.recordPayment');

  return (
    <div className="landing-mock landing-mock--drawer">
      <div className="landing-mock-header">
        <span className="landing-mock-title">{t('transactions.partialPayment.title')}</span>
        <span className="landing-mock-subtitle">{t(SAMPLE_PAYMENT.titleKey)}</span>
      </div>

      <div className="landing-mock-field">
        <span className="landing-mock-label">{t('transactions.partialPayment.amount')}</span>
        <span className="landing-mock-input landing-mock-input--amount">
          {money(SAMPLE_PAYMENT.remainingMinor, SAMPLE_PAYMENT.currency)}
        </span>
      </div>

      <div className="landing-mock-field">
        <span className="landing-mock-label">{t('transactions.partialPayment.date')}</span>
        <span className="landing-mock-input">{t('landing.sample.today')}</span>
      </div>

      <div className="landing-mock-actions">
        <span className="landing-mock-button">{action}</span>
      </div>
    </div>
  );
}
