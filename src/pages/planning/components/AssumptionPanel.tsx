import { useState, useMemo } from 'react';
import { useT } from '../../../lib/i18n';
import { formatAmount, cn } from '../../../lib/utils';
import type { PlanAssumption, Currency, AssumptionCategory } from '../../../types';

interface AssumptionPanelProps {
  assumptions: PlanAssumption[];
  currency: Currency;
  locale: string;
  onAdd: (category?: AssumptionCategory) => void;
  onEdit: (assumptionId: string) => void;
}

const CATEGORY_ORDER: AssumptionCategory[] = ['revenue', 'expense', 'funding', 'hiring'];

const CATEGORY_ICONS: Partial<Record<AssumptionCategory, string>> = {
  revenue: '+',
  expense: '-',
  funding: '$',
  hiring: '@',
};

export function AssumptionPanel({
  assumptions,
  currency,
  locale,
  onAdd,
  onEdit,
}: AssumptionPanelProps) {
  const t = useT();
  const [expandedCategories, setExpandedCategories] = useState<Set<AssumptionCategory>>(
    new Set(['revenue', 'expense'])
  );

  // Group assumptions by category
  const grouped = useMemo(() => {
    const groups: Partial<Record<AssumptionCategory, PlanAssumption[]>> = {
      revenue: [],
      expense: [],
      funding: [],
      hiring: [],
    };

    for (const assumption of assumptions) {
      // Skip 'other' category
      if (assumption.category === 'other') continue;
      if (groups[assumption.category]) {
        groups[assumption.category]!.push(assumption);
      }
    }

    return groups;
  }, [assumptions]);

  // Calculate totals by category (only for plan's currency)
  const totals = useMemo(() => {
    const result: Partial<Record<AssumptionCategory, number>> = {
      revenue: 0,
      expense: 0,
      funding: 0,
      hiring: 0,
    };

    for (const assumption of assumptions) {
      // Skip 'other' category
      if (assumption.category === 'other') continue;
      // Only sum assumptions in the plan's default currency for totals
      if (assumption.currency === currency && result[assumption.category] !== undefined) {
        result[assumption.category]! += assumption.amountMinor;
      }
    }

    return result;
  }, [assumptions, currency]);

  const toggleCategory = (category: AssumptionCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getCategoryLabel = (category: AssumptionCategory) => {
    return t(`planning.assumptions.categories.${category}`);
  };

  const getFrequencyLabel = (assumption: PlanAssumption) => {
    if (assumption.type === 'one_time') {
      return t('planning.assumptions.types.oneTime');
    }
    if (assumption.frequency) {
      return t(`planning.assumptions.frequency.${assumption.frequency}`);
    }
    return '';
  };

  return (
    <div className="assumption-panel">
      <div className="assumption-panel-header">
        <h3>{t('planning.assumptions.title')}</h3>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => onAdd()}
        >
          + {t('common.add')}
        </button>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const items = grouped[category] || [];
        const total = totals[category] || 0;
        const isExpanded = expandedCategories.has(category);

        return (
          <div key={category} className="assumption-category">
            <div
              className="assumption-category-header"
              onClick={() => toggleCategory(category)}
            >
              <span className="category-title">
                <span className="category-icon">{CATEGORY_ICONS[category]}</span>
                {getCategoryLabel(category)}
                {items.length > 0 && (
                  <span className="category-count">{items.length}</span>
                )}
              </span>
              <span className="category-total">
                {total > 0 ? formatAmount(total, currency, locale) : '-'}
              </span>
            </div>

            {isExpanded && (
              <div className="assumption-list">
                {items.length === 0 ? (
                  <button
                    className="add-assumption-btn"
                    onClick={() => onAdd(category)}
                  >
                    + {t('planning.assumptions.addFirst', { category: getCategoryLabel(category) })}
                  </button>
                ) : (
                  <>
                    {items.map((assumption) => (
                      <div
                        key={assumption.id}
                        className="assumption-item"
                        onClick={() => onEdit(assumption.id)}
                      >
                        <div className="assumption-item-left">
                          <span className="assumption-label">
                            {assumption.label}
                            <span
                              className={cn('confidence-indicator', assumption.confidence)}
                              title={t(`planning.assumptions.confidence.${assumption.confidence}`)}
                            />
                          </span>
                          <span className="assumption-meta">
                            {getFrequencyLabel(assumption)}
                            {assumption.startMonth && ` • ${assumption.startMonth}`}
                            {assumption.endMonth && ` - ${assumption.endMonth}`}
                          </span>
                        </div>
                        <span className="assumption-amount">
                          {formatAmount(assumption.amountMinor, assumption.currency, locale)}
                        </span>
                      </div>
                    ))}
                    <button
                      className="add-assumption-btn"
                      onClick={() => onAdd(category)}
                      style={{ marginTop: '0.5rem' }}
                    >
                      + {t('common.add')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
