import { useT } from '../../../lib/i18n';
import { CurrencySummaryPopup } from '../../../components/ui/CurrencySummaryPopup';
import type { PlanSummary } from '../../../types';

interface PlanSummaryStripProps {
  summary: PlanSummary;
}

export function PlanSummaryStrip({ summary }: PlanSummaryStripProps) {
  const t = useT();

  return (
    <div className="summary-strip">
      {/* Funding Ask */}
      <div className="summary-card">
        <div className="summary-card-label">{t('planning.summary.ask')}</div>
        <div className="summary-card-value">
          <CurrencySummaryPopup
            usdAmountMinor={summary.askByCurrency.usdMinor}
            ilsAmountMinor={summary.askByCurrency.ilsMinor}
            eurAmountMinor={summary.askByCurrency.eurMinor}
            type="neutral"
          />
        </div>
      </div>

      {/* Monthly Burn */}
      <div className="summary-card">
        <div className="summary-card-label">{t('planning.summary.monthlyBurn')}</div>
        <div className={`summary-card-value ${summary.monthlyBurnMinor > 0 ? 'negative' : ''}`}>
          <CurrencySummaryPopup
            usdAmountMinor={summary.burnByCurrency.usdMinor}
            ilsAmountMinor={summary.burnByCurrency.ilsMinor}
            eurAmountMinor={summary.burnByCurrency.eurMinor}
            type={summary.monthlyBurnMinor > 0 ? 'expense' : 'neutral'}
          />
        </div>
      </div>

      {/* Average Monthly Revenue */}
      <div className="summary-card">
        <div className="summary-card-label">{t('planning.summary.monthlyRevenue')}</div>
        <div className="summary-card-value positive">
          <CurrencySummaryPopup
            usdAmountMinor={summary.revenueByCurrency.usdMinor}
            ilsAmountMinor={summary.revenueByCurrency.ilsMinor}
            eurAmountMinor={summary.revenueByCurrency.eurMinor}
            type="income"
          />
        </div>
      </div>

      {/* Runway */}
      <div className="summary-card">
        <div className="summary-card-label">{t('planning.summary.runway')}</div>
        <div className={`summary-card-value ${summary.runwayMonths < 6 ? 'warning' : ''}`}>
          {summary.runwayMonths} {t('planning.summary.months')}
        </div>
      </div>

      {/* Break-Even */}
      <div className="summary-card">
        <div className="summary-card-label">{t('planning.summary.breakEven')}</div>
        <div className={`summary-card-value ${summary.breakEvenMonth ? 'positive' : ''}`}>
          {summary.breakEvenMonth || t('planning.summary.notReached')}
        </div>
      </div>

      {/* Worst Cash Dip */}
      <div className="summary-card">
        <div className="summary-card-label">{t('planning.summary.worstDip')}</div>
        <div className={`summary-card-value ${summary.worstCashDipMinor < 0 ? 'negative' : ''}`}>
          <CurrencySummaryPopup
            usdAmountMinor={summary.worstDipByCurrency.usdMinor}
            ilsAmountMinor={summary.worstDipByCurrency.ilsMinor}
            eurAmountMinor={summary.worstDipByCurrency.eurMinor}
            type={summary.worstCashDipMinor < 0 ? 'expense' : 'neutral'}
          />
        </div>
      </div>

      {/* Buffer Needed */}
      <div className="summary-card">
        <div className="summary-card-label">{t('planning.summary.bufferNeeded')}</div>
        <div className="summary-card-value">
          <CurrencySummaryPopup
            usdAmountMinor={summary.bufferByCurrency.usdMinor}
            ilsAmountMinor={summary.bufferByCurrency.ilsMinor}
            eurAmountMinor={summary.bufferByCurrency.eurMinor}
            type="neutral"
          />
        </div>
      </div>
    </div>
  );
}
