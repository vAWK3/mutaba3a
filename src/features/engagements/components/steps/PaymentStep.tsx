import { useEffect, useRef } from 'react';
import { useFormContext, useFieldArray, Controller } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import { useWizardStore } from '../../hooks/useWizardStore';
import type { EngagementSnapshot, PaymentScheduleItem, PaymentTrigger, RolloverRule } from '../../types';
import type { Currency } from '../../../../types';
import { nanoid } from 'nanoid';
import {
  generatePaymentSchedule,
  resetPaymentSchedule,
  shouldAutoFillSchedule,
} from '../../services/paymentService';

interface PaymentStepProps {
  className?: string;
}

const CURRENCIES: { value: Currency; label: string; symbol: string }[] = [
  { value: 'USD', label: 'USD', symbol: '$' },
  { value: 'ILS', label: 'ILS', symbol: '₪' },
  { value: 'EUR', label: 'EUR', symbol: '€' },
];

const PAYMENT_TRIGGERS: { value: PaymentTrigger; label: string }[] = [
  { value: 'on_signing', label: 'On signing' },
  { value: 'on_milestone', label: 'On milestone' },
  { value: 'on_completion', label: 'On completion' },
  { value: 'monthly', label: 'Monthly' },
];

const ROLLOVER_RULES: { value: RolloverRule; label: string; description: string }[] = [
  { value: 'none', label: 'No rollover', description: 'Unused hours/capacity expire at month end' },
  { value: 'carry', label: 'Carry forward', description: 'Unused capacity rolls to next month' },
  { value: 'expire', label: 'Use or lose', description: 'Unused capacity is forfeited' },
];

export function PaymentStep({ className }: PaymentStepProps) {
  const { register, control, watch, setValue, getValues } = useFormContext<EngagementSnapshot>();
  const { engagementType, primaryLanguage } = useWizardStore();
  const autoFillDone = useRef(false);

  const isTaskType = engagementType === 'task';
  const isRetainerType = engagementType === 'retainer';

  const selectedCurrency = watch('currency') || 'USD';
  const totalAmountMinor = watch('totalAmountMinor') || 0;
  const depositPercent = watch('depositPercent') || 0;
  const milestones = watch('milestones') || [];
  const deliverables = watch('deliverables') || [];

  const { fields: scheduleItems, append: appendItem, remove: removeItem, replace: replaceItems } = useFieldArray({
    control,
    name: 'scheduleItems',
  });

  const currencySymbol = CURRENCIES.find((c) => c.value === selectedCurrency)?.symbol || '$';

  const formatAmount = (minor: number) => {
    return (minor / 100).toFixed(2);
  };

  const parseAmount = (value: string) => {
    return Math.round(parseFloat(value || '0') * 100);
  };

  // Auto-fill payment schedule on mount if empty and total is set
  useEffect(() => {
    if (autoFillDone.current) return;

    const currentSchedule = getValues('scheduleItems') || [];
    const currentTotal = getValues('totalAmountMinor') || 0;

    if (shouldAutoFillSchedule(currentSchedule, currentTotal)) {
      const newSchedule = generatePaymentSchedule(
        milestones,
        deliverables,
        currentTotal,
        selectedCurrency,
        [],
        primaryLanguage
      );
      replaceItems(newSchedule);
      autoFillDone.current = true;
    }
  }, [getValues, milestones, deliverables, selectedCurrency, primaryLanguage, replaceItems]);

  const addScheduleItem = () => {
    appendItem({
      id: nanoid(),
      label: '',
      trigger: 'on_milestone',
      amountMinor: 0,
      currency: selectedCurrency,
      generated: false,
      userEdited: false,
    } as PaymentScheduleItem);
  };

  const handleResetSchedule = () => {
    const newSchedule = resetPaymentSchedule(
      milestones,
      deliverables,
      totalAmountMinor,
      selectedCurrency,
      primaryLanguage
    );
    replaceItems(newSchedule);
  };

  const handlePaymentChange = (index: number) => {
    const item = scheduleItems[index] as PaymentScheduleItem;
    if (item.generated && !item.userEdited) {
      setValue(`scheduleItems.${index}.userEdited`, true);
    }
  };

  const depositAmount = Math.round((totalAmountMinor * depositPercent) / 100);

  // Calculate schedule total
  const scheduleTotal = scheduleItems.reduce(
    (sum, item) => sum + ((item as PaymentScheduleItem).amountMinor || 0),
    0
  );
  const scheduleDifference = totalAmountMinor - scheduleTotal;

  return (
    <div className={cn('wizard-step-content', className)}>
      <div className="step-header">
        <h2 className="step-title">Payment Terms</h2>
        <p className="step-description">
          {isTaskType
            ? 'Set the total price and payment schedule.'
            : 'Configure retainer pricing and billing.'}
        </p>
      </div>

      {/* Currency Selection */}
      <div className="form-section">
        <h3 className="section-title">Currency</h3>
        <div className="currency-selector">
          {CURRENCIES.map((cur) => (
            <button
              key={cur.value}
              type="button"
              className={cn(
                'currency-option',
                selectedCurrency === cur.value && 'currency-option-active'
              )}
              onClick={() => setValue('currency', cur.value)}
            >
              {cur.symbol} {cur.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task: Total Amount & Deposit */}
      {isTaskType && (
        <>
          <div className="form-section">
            <h3 className="section-title">Project Total</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Total Amount</label>
                <div className="input-with-prefix">
                  <span className="input-prefix">{currencySymbol}</span>
                  <Controller
                    name="totalAmountMinor"
                    control={control}
                    render={({ field }) => (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input"
                        value={formatAmount(field.value || 0)}
                        onChange={(e) => field.onChange(parseAmount(e.target.value))}
                      />
                    )}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3 className="section-title">Deposit</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Deposit Percentage</label>
                <div className="input-with-suffix">
                  <Controller
                    name="depositPercent"
                    control={control}
                    render={({ field }) => (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className="input"
                        style={{ width: 100 }}
                        value={field.value || 0}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    )}
                  />
                  <span className="input-suffix">%</span>
                </div>
              </div>
              {depositPercent > 0 && totalAmountMinor > 0 && (
                <div className="form-group">
                  <label className="form-label">Deposit Amount</label>
                  <p className="calculated-value">
                    {currencySymbol}{formatAmount(depositAmount)}
                  </p>
                </div>
              )}
            </div>
            <p className="form-hint">
              A deposit protects your work and shows client commitment.
            </p>
          </div>

          {/* Payment Schedule */}
          <div className="form-section">
            <div className="section-header">
              <h3 className="section-title">Payment Schedule</h3>
              <div className="section-actions">
                {(milestones.length > 0 || deliverables.length > 0) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleResetSchedule}
                    title="Regenerate schedule from milestones/deliverables"
                  >
                    ↺ Reset Schedule
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={addScheduleItem}>
                  + Add Payment
                </button>
              </div>
            </div>

            {scheduleItems.length > 0 && totalAmountMinor > 0 && scheduleDifference !== 0 && (
              <div className={cn('schedule-alert', scheduleDifference > 0 ? 'schedule-alert-warning' : 'schedule-alert-error')}>
                {scheduleDifference > 0
                  ? `${currencySymbol}${formatAmount(scheduleDifference)} remaining to allocate`
                  : `Schedule exceeds total by ${currencySymbol}${formatAmount(Math.abs(scheduleDifference))}`}
              </div>
            )}

            <div className="schedule-list">
              {scheduleItems.map((field, index) => {
                const item = field as PaymentScheduleItem;
                const isGenerated = item.generated;
                const wasEdited = item.userEdited;

                return (
                  <div key={field.id} className={cn('schedule-item', isGenerated && !wasEdited && 'schedule-item-generated')}>
                    <div className="schedule-item-main">
                      {isGenerated && (
                        <span className={cn('schedule-badge', wasEdited && 'schedule-badge-edited')} title={wasEdited ? 'Auto-generated (edited)' : 'Auto-generated'}>
                          {wasEdited ? 'A*' : 'A'}
                        </span>
                      )}
                      <input
                        type="text"
                        className="input"
                        placeholder="Payment label"
                        {...register(`scheduleItems.${index}.label` as const)}
                        onChange={(e) => {
                          handlePaymentChange(index);
                          register(`scheduleItems.${index}.label` as const).onChange(e);
                        }}
                      />
                    </div>
                    <Controller
                      name={`scheduleItems.${index}.trigger` as const}
                      control={control}
                      render={({ field: triggerField }) => (
                        <select
                          className="select"
                          value={triggerField.value}
                          onChange={(e) => {
                            handlePaymentChange(index);
                            triggerField.onChange(e.target.value);
                          }}
                        >
                          {PAYMENT_TRIGGERS.filter(t => t.value !== 'monthly').map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      )}
                    />
                    <div className="input-with-prefix" style={{ width: 150 }}>
                      <span className="input-prefix">{currencySymbol}</span>
                      <Controller
                        name={`scheduleItems.${index}.amountMinor` as const}
                        control={control}
                        render={({ field: amountField }) => (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input"
                            value={formatAmount(amountField.value || 0)}
                            onChange={(e) => {
                              handlePaymentChange(index);
                              amountField.onChange(parseAmount(e.target.value));
                            }}
                          />
                        )}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      onClick={() => removeItem(index)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            {scheduleItems.length === 0 && totalAmountMinor > 0 && (
              <div className="empty-schedule">
                <p>No payment schedule defined.</p>
                {milestones.length > 0 || deliverables.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleResetSchedule}
                  >
                    Generate from {milestones.length > 0 ? 'Milestones' : 'Deliverables'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={addScheduleItem}
                  >
                    Add First Payment
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Retainer: Monthly Amount */}
      {isRetainerType && (
        <>
          <div className="form-section">
            <h3 className="section-title">Monthly Retainer</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Monthly Amount</label>
                <div className="input-with-prefix">
                  <span className="input-prefix">{currencySymbol}</span>
                  <Controller
                    name="retainerAmountMinor"
                    control={control}
                    render={({ field }) => (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input"
                        value={formatAmount(field.value || 0)}
                        onChange={(e) => field.onChange(parseAmount(e.target.value))}
                      />
                    )}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Billing Day</label>
                <Controller
                  name="billingDay"
                  control={control}
                  render={({ field }) => (
                    <select
                      className="select"
                      value={field.value || 1}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                        <option key={day} value={day}>
                          {day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`}
                        </option>
                      ))}
                    </select>
                  )}
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3 className="section-title">Capacity Rollover</h3>
            <div className="rollover-options">
              {ROLLOVER_RULES.map((rule) => (
                <Controller
                  key={rule.value}
                  name="rolloverRule"
                  control={control}
                  render={({ field }) => (
                    <label className={cn('rollover-option', field.value === rule.value && 'active')}>
                      <input
                        type="radio"
                        value={rule.value}
                        checked={field.value === rule.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                      <div>
                        <span className="rollover-label">{rule.label}</span>
                        <span className="rollover-desc">{rule.description}</span>
                      </div>
                    </label>
                  )}
                />
              ))}
            </div>
          </div>

          <div className="form-section">
            <h3 className="section-title">Out-of-Scope Rate</h3>
            <div className="form-group">
              <label className="form-label">Hourly Rate for Extra Work</label>
              <div className="input-with-prefix">
                <span className="input-prefix">{currencySymbol}</span>
                <Controller
                  name="outOfScopeRateMinor"
                  control={control}
                  render={({ field }) => (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input"
                      style={{ width: 120 }}
                      value={formatAmount(field.value || 0)}
                      onChange={(e) => field.onChange(parseAmount(e.target.value))}
                    />
                  )}
                />
              </div>
              <p className="form-hint">
                Rate charged for work beyond the monthly capacity.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Late Fee */}
      <div className="form-section">
        <h3 className="section-title">Late Payment</h3>
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              {...register('lateFeeEnabled')}
            />
            <span>Enable late payment fee</span>
          </label>
          <p className="form-hint">
            A late fee clause encourages timely payments.
          </p>
        </div>
      </div>

      <style>{`
        .wizard-step-content {
          max-width: 700px;
        }

        .step-header {
          margin-bottom: 32px;
        }

        .step-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .step-description {
          color: var(--text-muted);
          margin: 0;
          font-size: 14px;
        }

        .form-section {
          margin-bottom: 32px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .section-actions {
          display: flex;
          gap: 8px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .currency-selector {
          display: flex;
          gap: 8px;
        }

        .currency-option {
          padding: 8px 16px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.15s ease;
        }

        .currency-option:hover {
          border-color: var(--primary);
        }

        .currency-option-active {
          border-color: var(--primary);
          background: var(--primary);
          color: white;
        }

        .input-with-prefix,
        .input-with-suffix {
          display: flex;
          align-items: center;
        }

        .input-prefix {
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-right: none;
          border-radius: 6px 0 0 6px;
          color: var(--text-muted);
        }

        .input-with-prefix .input {
          border-radius: 0 6px 6px 0;
        }

        .input-suffix {
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-left: none;
          border-radius: 0 6px 6px 0;
          color: var(--text-muted);
        }

        .input-with-suffix .input {
          border-radius: 6px 0 0 6px;
        }

        .calculated-value {
          font-size: 18px;
          font-weight: 500;
          margin: 0;
          padding-top: 8px;
        }

        .schedule-alert {
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 13px;
          margin-bottom: 12px;
        }

        .schedule-alert-warning {
          background: rgba(var(--warning-rgb, 234, 179, 8), 0.1);
          color: var(--warning, #eab308);
          border: 1px solid rgba(var(--warning-rgb, 234, 179, 8), 0.3);
        }

        .schedule-alert-error {
          background: rgba(var(--danger-rgb, 239, 68, 68), 0.1);
          color: var(--danger, #ef4444);
          border: 1px solid rgba(var(--danger-rgb, 239, 68, 68), 0.3);
        }

        .schedule-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .schedule-item {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .schedule-item-generated {
          background: rgba(var(--primary-rgb), 0.02);
          padding: 8px;
          border-radius: 6px;
          border: 1px solid rgba(var(--primary-rgb), 0.2);
          margin: -8px;
        }

        .schedule-item-main {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .schedule-item-main .input {
          flex: 1;
        }

        .schedule-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          background: rgba(var(--primary-rgb), 0.1);
          color: var(--primary);
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .schedule-badge-edited {
          background: rgba(var(--warning-rgb, 234, 179, 8), 0.1);
          color: var(--warning, #eab308);
        }

        .schedule-item .select {
          width: 140px;
        }

        .empty-schedule {
          padding: 24px;
          text-align: center;
          background: var(--bg-elevated);
          border-radius: 8px;
          border: 1px dashed var(--border);
        }

        .empty-schedule p {
          color: var(--text-muted);
          margin: 0 0 12px;
          font-size: 13px;
        }

        .rollover-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .rollover-option {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
        }

        .rollover-option.active {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.05);
        }

        .rollover-option input {
          margin-top: 2px;
        }

        .rollover-label {
          display: block;
          font-weight: 500;
          font-size: 14px;
        }

        .rollover-desc {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 14px;
        }

        .checkbox-label input {
          width: 16px;
          height: 16px;
        }
      `}</style>
    </div>
  );
}
