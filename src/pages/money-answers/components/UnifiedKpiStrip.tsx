import { useT } from '../../../lib/i18n';
import { CurrencySummaryPopup } from '../../../components/ui/CurrencySummaryPopup';

interface KPIsByCurrency {
  USD: {
    willMakeItMinor: number;
    cashOnHandMinor: number;
    comingMinor: number;
    leakingMinor: number;
    netForecastMinor: number;
  };
  ILS: {
    willMakeItMinor: number;
    cashOnHandMinor: number;
    comingMinor: number;
    leakingMinor: number;
    netForecastMinor: number;
  };
}

interface UnifiedKpiStripProps {
  kpis?: KPIsByCurrency;
}

export function UnifiedKpiStrip({ kpis }: UnifiedKpiStripProps) {
  const t = useT();

  if (!kpis) {
    return (
      <div className="kpi-strip">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>
    );
  }

  const willMakeItNet = kpis.USD.willMakeItMinor + kpis.ILS.willMakeItMinor;
  const cashOnHandNet = kpis.USD.cashOnHandMinor + kpis.ILS.cashOnHandMinor;

  return (
    <div className="kpi-strip">
      {/* Will I Make It? */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.kpi.willMakeIt')}</div>
        <div className="kpi-card-value-unified">
          <CurrencySummaryPopup
            usdAmountMinor={kpis.USD.willMakeItMinor}
            ilsAmountMinor={kpis.ILS.willMakeItMinor}
            type={willMakeItNet >= 0 ? 'income' : 'expense'}
            size="large"
          />
        </div>
        <div className="kpi-card-subtitle">{t('moneyAnswers.kpi.endOfMonthForecast')}</div>
      </div>

      {/* Cash on Hand */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.kpi.cashOnHand')}</div>
        <div className="kpi-card-value-unified">
          <CurrencySummaryPopup
            usdAmountMinor={kpis.USD.cashOnHandMinor}
            ilsAmountMinor={kpis.ILS.cashOnHandMinor}
            type={cashOnHandNet >= 0 ? 'income' : 'expense'}
            size="large"
          />
        </div>
        <div className="kpi-card-subtitle">{t('moneyAnswers.kpi.currentBalance')}</div>
      </div>

      {/* Coming vs Leaking */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.kpi.comingVsLeaking')}</div>
        <div className="kpi-card-coming-leaking-unified">
          <div className="kpi-incoming-unified">
            <ArrowUpIcon />
            <CurrencySummaryPopup
              usdAmountMinor={kpis.USD.comingMinor}
              ilsAmountMinor={kpis.ILS.comingMinor}
              type="income"
            />
          </div>
          <span className="kpi-divider">/</span>
          <div className="kpi-outgoing-unified">
            <ArrowDownIcon />
            <CurrencySummaryPopup
              usdAmountMinor={kpis.USD.leakingMinor}
              ilsAmountMinor={kpis.ILS.leakingMinor}
              type="expense"
            />
          </div>
        </div>
        <div className="kpi-card-subtitle">
          {t('moneyAnswers.kpi.netForecast')}: {' '}
          <CurrencySummaryPopup
            usdAmountMinor={kpis.USD.netForecastMinor}
            ilsAmountMinor={kpis.ILS.netForecastMinor}
            type="net"
          />
        </div>
      </div>
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div className="kpi-card">
      <div className="kpi-card-label skeleton" style={{ width: '60%', height: '12px' }} />
      <div className="kpi-card-value skeleton" style={{ width: '80%', height: '28px', marginTop: '8px' }} />
      <div className="kpi-card-subtitle skeleton" style={{ width: '50%', height: '12px', marginTop: '8px' }} />
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 4.5 15 15m0 0V8.25m0 11.25H8.25" />
    </svg>
  );
}
