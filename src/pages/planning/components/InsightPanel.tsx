import { useT, useLanguage, getLocale } from '../../../lib/i18n';
import { formatAmount } from '../../../lib/utils';
import type { PlanInsight } from '../../../types';

interface InsightPanelProps {
  insights: PlanInsight[];
}

const SEVERITY_ICONS: Record<string, string> = {
  critical: '!',
  warning: '!',
  info: 'i',
};

export function InsightPanel({ insights }: InsightPanelProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const renderInsightMessage = (insight: PlanInsight) => {
    // Get the base message
    let message = t(insight.messageKey);

    // Replace variables if present
    if (insight.variables) {
      for (const [key, value] of Object.entries(insight.variables)) {
        const placeholder = `{${key}}`;
        let displayValue: string;

        // Format amounts
        if (key === 'amount' || key === 'burn' || key === 'revenue') {
          displayValue = formatAmount(value as number, 'USD', locale);
        } else {
          displayValue = String(value);
        }

        message = message.replace(placeholder, displayValue);
      }
    }

    return message;
  };

  // Sort insights by severity
  const sortedInsights = [...insights].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="insight-panel">
      <h3>{t('planning.insights.title')}</h3>
      <div className="insight-list">
        {sortedInsights.map((insight) => (
          <div key={insight.id} className={`insight-item ${insight.severity}`}>
            <span className="insight-icon">
              {SEVERITY_ICONS[insight.severity]}
            </span>
            <span className="insight-message">
              {renderInsightMessage(insight)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
