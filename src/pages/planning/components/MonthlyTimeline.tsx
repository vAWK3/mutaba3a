import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../../lib/i18n';
import { formatAmount } from '../../../lib/utils';
import type { MonthProjection, Currency } from '../../../types';

interface MonthlyTimelineProps {
  projections: MonthProjection[];
  currency: Currency;
  locale: string;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  projection: MonthProjection | null;
}

export function MonthlyTimeline({ projections, currency, locale }: MonthlyTimelineProps) {
  const t = useT();
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    projection: null,
  });

  // Calculate max values for scaling bars
  const { maxIn, maxOut } = useMemo(() => {
    let maxIn = 0;
    let maxOut = 0;
    for (const p of projections) {
      if (p.cashInMinor > maxIn) maxIn = p.cashInMinor;
      if (p.cashOutMinor > maxOut) maxOut = p.cashOutMinor;
    }
    return { maxIn: maxIn || 1, maxOut: maxOut || 1 };
  }, [projections]);

  const maxAmount = Math.max(maxIn, maxOut);

  // Format month label
  const formatMonthLabel = (month: string) => {
    const [year, m] = month.split('-');
    const date = new Date(Number(year), Number(m) - 1);
    return date.toLocaleDateString(locale, { month: 'short' });
  };

  // Format full month label for tooltip
  const formatFullMonthLabel = (month: string) => {
    const [year, m] = month.split('-');
    const date = new Date(Number(year), Number(m) - 1);
    return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  };

  // Get first and last closing balance
  const firstBalance = projections[0]?.openingCashMinor || 0;
  const lastBalance = projections[projections.length - 1]?.closingCashMinor || 0;

  const handleMouseEnter = (e: React.MouseEvent, projection: MonthProjection) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      visible: true,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      projection,
    });
  };

  const handleMouseLeave = () => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  return (
    <div className="monthly-timeline">
      <div className="monthly-timeline-header">
        <h3>{t('planning.timeline.title')}</h3>
        <div className="timeline-legend">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--success)' }} />
            {t('planning.timeline.cashIn')}
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--error)' }} />
            {t('planning.timeline.cashOut')}
          </span>
        </div>
      </div>

      <div className="timeline-chart">
        {projections.map((projection) => {
          const inHeight = Math.max(2, (projection.cashInMinor / maxAmount) * 150);
          const outHeight = Math.max(2, (projection.cashOutMinor / maxAmount) * 150);

          return (
            <div
              key={projection.month}
              className="timeline-bar-group"
              onMouseEnter={(e) => handleMouseEnter(e, projection)}
              onMouseLeave={handleMouseLeave}
            >
              <div className="timeline-bars-container">
                <div
                  className="timeline-bar in"
                  style={{
                    height: projection.cashInMinor > 0 ? `${inHeight}px` : '0px',
                  }}
                />
                <div
                  className="timeline-bar out"
                  style={{
                    height: projection.cashOutMinor > 0 ? `${outHeight}px` : '0px',
                  }}
                />
              </div>
              <span className="timeline-month-label">
                {formatMonthLabel(projection.month)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="timeline-balance-line">
        <span>
          {t('planning.timeline.startingCash')}: {formatAmount(firstBalance, currency, locale)}
        </span>
        <span>
          {t('planning.timeline.endingCash')}: {formatAmount(lastBalance, currency, locale)}
        </span>
      </div>

      {/* Tooltip Portal */}
      {tooltip.visible && tooltip.projection && createPortal(
        <div
          className="timeline-tooltip"
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
        >
          <div className="timeline-tooltip-title">
            {formatFullMonthLabel(tooltip.projection.month)}
          </div>
          <div className="timeline-tooltip-row">
            <span className="timeline-tooltip-dot in" />
            <span className="timeline-tooltip-label">{t('planning.timeline.cashIn')}:</span>
            <span className="timeline-tooltip-value positive">
              {formatAmount(tooltip.projection.cashInMinor, currency, locale)}
            </span>
          </div>
          <div className="timeline-tooltip-row">
            <span className="timeline-tooltip-dot out" />
            <span className="timeline-tooltip-label">{t('planning.timeline.cashOut')}:</span>
            <span className="timeline-tooltip-value negative">
              {formatAmount(tooltip.projection.cashOutMinor, currency, locale)}
            </span>
          </div>
          <div className="timeline-tooltip-divider" />
          <div className="timeline-tooltip-row">
            <span className="timeline-tooltip-label">{t('planning.timeline.netFlow')}:</span>
            <span className={`timeline-tooltip-value ${tooltip.projection.netFlowMinor >= 0 ? 'positive' : 'negative'}`}>
              {formatAmount(tooltip.projection.netFlowMinor, currency, locale)}
            </span>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        .timeline-legend {
          display: flex;
          gap: 1rem;
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .timeline-bar-group {
          cursor: pointer;
        }

        .timeline-bar-group:hover .timeline-bar {
          opacity: 0.8;
        }

        .timeline-bars-container {
          display: flex;
          gap: 2px;
          align-items: flex-end;
          height: 150px;
          width: 100%;
          justify-content: center;
        }

        .timeline-bar {
          width: 12px;
          border-radius: 2px 2px 0 0;
          transition: opacity 0.15s ease;
        }

        .timeline-bar.in {
          background: var(--success);
        }

        .timeline-bar.out {
          background: var(--error);
        }

        .timeline-tooltip {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.75rem;
          box-shadow: var(--shadow-2);
          min-width: 180px;
          pointer-events: none;
        }

        .timeline-tooltip-title {
          font-weight: var(--weight-semibold);
          margin-bottom: 0.5rem;
          color: var(--text);
        }

        .timeline-tooltip-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: var(--text-sm);
          margin-bottom: 0.25rem;
        }

        .timeline-tooltip-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .timeline-tooltip-dot.in {
          background: var(--success);
        }

        .timeline-tooltip-dot.out {
          background: var(--error);
        }

        .timeline-tooltip-label {
          color: var(--text-secondary);
          flex: 1;
        }

        .timeline-tooltip-value {
          font-weight: var(--weight-medium);
          font-family: var(--font-mono);
        }

        .timeline-tooltip-value.positive {
          color: var(--success);
        }

        .timeline-tooltip-value.negative {
          color: var(--error);
        }

        .timeline-tooltip-divider {
          height: 1px;
          background: var(--border);
          margin: 0.5rem 0;
        }
      `}</style>
    </div>
  );
}
