/**
 * RecurringRuleDrawer Component
 *
 * Drawer for creating and editing recurring expense rules.
 * Features:
 * - Frequency picker (monthly/yearly)
 * - Day of month selection (1-28)
 * - Month selection (for yearly)
 * - Category and vendor typeahead
 * - End mode selection
 * - Reminder days configuration
 */

import { useState, useEffect } from 'react';
import { Drawer } from './Drawer';
import { useT } from '../../lib/i18n';
import { useActiveProfile } from '../../hooks/useActiveProfile';
import {
  useRecurringRule,
  useCreateRecurringRule,
  useUpdateRecurringRule,
  useDeleteRecurringRule,
  usePauseRecurringRule,
  useResumeRecurringRule,
  useRuleHistory,
} from '../../hooks/useRecurringExpenseQueries';
import { useExpenseCategories } from '../../hooks/useExpenseQueries';
import { useProjects } from '../../hooks/useQueries';
import { formatAmount, formatDate, todayISO } from '../../lib/utils';
import type { Currency, ExpenseFrequency, RecurringEndMode } from '../../types';
import './RecurringRuleDrawer.css';

interface RecurringRuleDrawerProps {
  ruleId?: string;
  isOpen: boolean;
  onClose: () => void;
}

const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1);
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function RecurringRuleDrawer({ ruleId, isOpen, onClose }: RecurringRuleDrawerProps) {
  const t = useT();
  const { activeProfileId } = useActiveProfile();
  const isEditing = !!ruleId;

  // Queries
  const { data: existingRule, isLoading: ruleLoading } = useRecurringRule(ruleId);
  const { data: categories = [] } = useExpenseCategories(activeProfileId);
  const { data: projects = [] } = useProjects(activeProfileId);
  const { data: history = [] } = useRuleHistory(ruleId);

  // Mutations
  const createMutation = useCreateRecurringRule();
  const updateMutation = useUpdateRecurringRule();
  const deleteMutation = useDeleteRecurringRule();
  const pauseMutation = usePauseRecurringRule();
  const resumeMutation = useResumeRecurringRule();

  // Form state
  const [title, setTitle] = useState('');
  const [vendor, setVendor] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [frequency, setFrequency] = useState<ExpenseFrequency>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [monthOfYear, setMonthOfYear] = useState(1);
  const [startDate, setStartDate] = useState(todayISO());
  const [endMode, setEndMode] = useState<RecurringEndMode>('noEnd');
  const [endDate, setEndDate] = useState('');
  const [scope, setScope] = useState<'general' | 'project'>('general');
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [reminderDaysBefore, setReminderDaysBefore] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  // Initialize form with existing rule data
  /* eslint-disable react-hooks/set-state-in-effect -- Form initialization from props is intentional */
  useEffect(() => {
    if (existingRule && isEditing) {
      setTitle(existingRule.title || '');
      setVendor(existingRule.vendor || '');
      setCategoryId(existingRule.categoryId || '');
      setAmountStr(String(existingRule.amountMinor / 100));
      setCurrency(existingRule.currency);
      setFrequency(existingRule.frequency);
      setDayOfMonth(existingRule.dayOfMonth);
      setMonthOfYear(existingRule.monthOfYear || 1);
      setStartDate(existingRule.startDate);
      setEndMode(existingRule.endMode);
      setEndDate(existingRule.endDate || '');
      setScope(existingRule.scope || 'general');
      setProjectId(existingRule.projectId || '');
      setNotes(existingRule.notes || '');
      setReminderDaysBefore(existingRule.reminderDaysBefore);
    } else if (!isEditing) {
      // Reset form for new rule
      setTitle('');
      setVendor('');
      setCategoryId('');
      setAmountStr('');
      setCurrency('USD');
      setFrequency('monthly');
      setDayOfMonth(1);
      setMonthOfYear(1);
      setStartDate(todayISO());
      setEndMode('noEnd');
      setEndDate('');
      setScope('general');
      setProjectId('');
      setNotes('');
      setReminderDaysBefore(0);
    }
  }, [existingRule, isEditing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!activeProfileId || !title.trim()) return;

    const amountMinor = Math.round(parseFloat(amountStr || '0') * 100);

    if (isEditing && ruleId) {
      await updateMutation.mutateAsync({
        id: ruleId,
        data: {
          title: title.trim(),
          vendor: vendor.trim() || undefined,
          categoryId: categoryId || undefined,
          amountMinor,
          currency,
          frequency,
          dayOfMonth,
          monthOfYear: frequency === 'yearly' ? monthOfYear : undefined,
          startDate,
          endMode,
          endDate: endMode === 'untilDate' ? endDate : undefined,
          scope,
          projectId: scope === 'project' ? projectId : undefined,
          notes: notes.trim() || undefined,
          reminderDaysBefore,
        },
      });
    } else {
      await createMutation.mutateAsync({
        profileId: activeProfileId,
        title: title.trim(),
        vendor: vendor.trim() || undefined,
        categoryId: categoryId || undefined,
        amountMinor,
        currency,
        frequency,
        dayOfMonth,
        monthOfYear: frequency === 'yearly' ? monthOfYear : undefined,
        startDate,
        endMode,
        endDate: endMode === 'untilDate' ? endDate : undefined,
        projectId: scope === 'project' ? projectId : undefined,
        scope,
        notes: notes.trim() || undefined,
        reminderDaysBefore,
      });
    }

    onClose();
  };

  const handleDelete = async () => {
    if (!ruleId) return;
    if (window.confirm(t('expenses.recurring.rule.deleteConfirm'))) {
      await deleteMutation.mutateAsync(ruleId);
      onClose();
    }
  };

  const handlePauseResume = async () => {
    if (!ruleId || !existingRule) return;
    if (existingRule.isPaused) {
      await resumeMutation.mutateAsync(ruleId);
    } else {
      await pauseMutation.mutateAsync(ruleId);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const canSave = title.trim() && amountStr && parseFloat(amountStr) > 0;

  return (
    <Drawer
      title={isEditing ? t('expenses.recurring.rule.edit') : t('expenses.recurring.rule.new')}
      onClose={onClose}
      footer={
        <div className="recurring-rule-drawer-footer">
          {isEditing && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {t('common.delete')}
            </button>
          )}
          <div className="recurring-rule-drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSaving || !canSave}
            >
              {isSaving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      }
    >
      {ruleLoading && isEditing ? (
        <div className="drawer-loading">{t('common.loading')}</div>
      ) : (
        <form className="recurring-rule-form" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          {/* Pause/Resume status */}
          {isEditing && existingRule && (
            <div className="form-group">
              <div className="recurring-rule-status">
                <span className={`status-badge ${existingRule.isPaused ? 'status-paused' : 'status-active'}`}>
                  {existingRule.isPaused ? t('expenses.recurring.paused') : t('expenses.recurring.active')}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={handlePauseResume}
                >
                  {existingRule.isPaused ? t('expenses.recurring.resume') : t('expenses.recurring.pause')}
                </button>
              </div>
            </div>
          )}

          {/* Title */}
          <div className="form-group">
            <label htmlFor="title">{t('expenses.recurring.rule.title')}</label>
            <input
              id="title"
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('expenses.recurring.rule.titlePlaceholder')}
              autoFocus
            />
          </div>

          {/* Amount and Currency */}
          <div className="form-row">
            <div className="form-group form-group-grow">
              <label htmlFor="amount">{t('expenses.recurring.rule.amount')}</label>
              <input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                className="form-input"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="form-group">
              <label htmlFor="currency">{t('drawer.transaction.currency')}</label>
              <select
                id="currency"
                className="form-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                <option value="USD">USD</option>
                <option value="ILS">ILS</option>
              </select>
            </div>
          </div>

          {/* Frequency */}
          <div className="form-group">
            <label>{t('expenses.recurring.frequency')}</label>
            <div className="form-radio-group">
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="frequency"
                  value="monthly"
                  checked={frequency === 'monthly'}
                  onChange={() => setFrequency('monthly')}
                />
                {t('expenses.recurring.monthly')}
              </label>
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="frequency"
                  value="yearly"
                  checked={frequency === 'yearly'}
                  onChange={() => setFrequency('yearly')}
                />
                {t('expenses.recurring.yearly')}
              </label>
            </div>
          </div>

          {/* Day of Month */}
          <div className="form-row">
            <div className="form-group form-group-grow">
              <label htmlFor="dayOfMonth">{t('expenses.recurring.dayOfMonth')}</label>
              <select
                id="dayOfMonth"
                className="form-select"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
              >
                {DAYS_OF_MONTH.map((day) => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            </div>

            {/* Month (for yearly) */}
            {frequency === 'yearly' && (
              <div className="form-group form-group-grow">
                <label htmlFor="monthOfYear">{t('expenses.recurring.monthOfYear')}</label>
                <select
                  id="monthOfYear"
                  className="form-select"
                  value={monthOfYear}
                  onChange={(e) => setMonthOfYear(Number(e.target.value))}
                >
                  {MONTHS.map((month, idx) => (
                    <option key={idx} value={idx + 1}>{month}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Category */}
          <div className="form-group">
            <label htmlFor="category">{t('drawer.expense.category')}</label>
            <select
              id="category"
              className="form-select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{t('drawer.expense.categoryPlaceholder')}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {/* Vendor */}
          <div className="form-group">
            <label htmlFor="vendor">{t('drawer.expense.vendor')}</label>
            <input
              id="vendor"
              type="text"
              className="form-input"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder={t('drawer.expense.vendorPlaceholder')}
            />
          </div>

          {/* Start Date */}
          <div className="form-group">
            <label htmlFor="startDate">{t('expenses.recurring.startDate')}</label>
            <input
              id="startDate"
              type="date"
              className="form-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {/* End Mode */}
          <div className="form-group">
            <label>{t('expenses.recurring.endMode')}</label>
            <div className="form-radio-group form-radio-group-vertical">
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="endMode"
                  value="noEnd"
                  checked={endMode === 'noEnd'}
                  onChange={() => setEndMode('noEnd')}
                />
                {t('expenses.recurring.noEnd')}
              </label>
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="endMode"
                  value="endOfYear"
                  checked={endMode === 'endOfYear'}
                  onChange={() => setEndMode('endOfYear')}
                />
                {t('expenses.recurring.endOfYear')}
              </label>
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="endMode"
                  value="untilDate"
                  checked={endMode === 'untilDate'}
                  onChange={() => setEndMode('untilDate')}
                />
                {t('expenses.recurring.untilDate')}
              </label>
            </div>
          </div>

          {/* End Date (if untilDate mode) */}
          {endMode === 'untilDate' && (
            <div className="form-group">
              <label htmlFor="endDate">{t('expenses.recurring.endDate')}</label>
              <input
                id="endDate"
                type="date"
                className="form-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}

          {/* Scope */}
          <div className="form-group">
            <label>{t('expenses.recurring.scope')}</label>
            <div className="form-radio-group">
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="scope"
                  value="general"
                  checked={scope === 'general'}
                  onChange={() => setScope('general')}
                />
                {t('expenses.recurring.scopeGeneral')}
              </label>
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="scope"
                  value="project"
                  checked={scope === 'project'}
                  onChange={() => setScope('project')}
                />
                {t('expenses.recurring.scopeProject')}
              </label>
            </div>
          </div>

          {/* Project (if project scope) */}
          {scope === 'project' && (
            <div className="form-group">
              <label htmlFor="project">{t('drawer.expense.projectPlaceholder')}</label>
              <select
                id="project"
                className="form-select"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Select project...</option>
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>{proj.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Reminder Days */}
          <div className="form-group">
            <label htmlFor="reminderDays">{t('expenses.recurring.reminderDays')}</label>
            <input
              id="reminderDays"
              type="number"
              min="0"
              max="30"
              className="form-input"
              value={reminderDaysBefore}
              onChange={(e) => setReminderDaysBefore(Number(e.target.value) || 0)}
            />
            <p className="form-hint">{t('expenses.recurring.reminderDaysHint')}</p>
          </div>

          {/* Notes */}
          <div className="form-group">
            <label htmlFor="notes">{t('expenses.recurring.occurrence.notes')}</label>
            <textarea
              id="notes"
              className="form-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('expenses.recurring.occurrence.notesPlaceholder')}
              rows={3}
            />
          </div>

          {/* Payment History (when editing) */}
          {isEditing && (
            <div className="form-group">
              <button
                type="button"
                className="btn btn-link"
                onClick={() => setShowHistory(!showHistory)}
              >
                {t('expenses.recurring.rule.history')} ({history.length})
              </button>
              {showHistory && (
                <div className="recurring-rule-history">
                  {history.length === 0 ? (
                    <p className="recurring-rule-history-empty">
                      {t('expenses.recurring.rule.noHistory')}
                    </p>
                  ) : (
                    <ul className="recurring-rule-history-list">
                      {history.map((occ) => (
                        <li key={occ.id} className="recurring-rule-history-item">
                          <span className="history-date">{formatDate(occ.expectedDate)}</span>
                          <span className={`history-status status-${occ.status}`}>
                            {t(`expenses.recurring.occurrence.state.${
                              occ.status === 'resolved_paid' ? 'paid' :
                              occ.status === 'resolved_skipped' ? 'skipped' :
                              'snoozed'
                            }`)}
                          </span>
                          {occ.actualAmountMinor && (
                            <span className="history-amount">
                              {formatAmount(occ.actualAmountMinor, occ.currencySnapshot)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </form>
      )}
    </Drawer>
  );
}
