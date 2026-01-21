import { useState } from 'react';
import { useFormContext, useFieldArray, Controller } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import { useWizardStore } from '../../hooks/useWizardStore';
import type { EngagementSnapshot } from '../../types';

interface ReviewsStepProps {
  className?: string;
}

const REVISION_DEFINITIONS = [
  { id: 'minor_text', label: 'Minor text changes' },
  { id: 'color_adjust', label: 'Color/font adjustments' },
  { id: 'layout_change', label: 'Layout changes' },
  { id: 'new_element', label: 'Adding new elements' },
  { id: 'concept_change', label: 'Concept direction change' },
  { id: 'functionality', label: 'Functionality changes' },
];

export function ReviewsStep({ className }: ReviewsStepProps) {
  const { register, control, watch, setValue } = useFormContext<EngagementSnapshot>();
  const { engagementType, engagementCategory } = useWizardStore();
  const [newScopeCategory, setNewScopeCategory] = useState('');

  const isTaskType = engagementType === 'task';
  const isRetainerType = engagementType === 'retainer';
  const isDesign = engagementCategory === 'design';
  const isDevelopment = engagementCategory === 'development';

  const revisionDefinitions = watch('revisionDefinition') || [];

  const { fields: scopeCategories, append: appendScope, remove: removeScope } = useFieldArray({
    control,
    name: 'scopeCategories' as any,
  });

  const toggleRevisionDefinition = (id: string) => {
    const current = revisionDefinitions;
    if (current.includes(id)) {
      setValue('revisionDefinition', current.filter((d: string) => d !== id));
    } else {
      setValue('revisionDefinition', [...current, id]);
    }
  };

  const addScopeCategory = () => {
    if (newScopeCategory.trim()) {
      appendScope(newScopeCategory.trim() as any);
      setNewScopeCategory('');
    }
  };

  return (
    <div className={cn('wizard-step-content', className)}>
      <div className="step-header">
        <h2 className="step-title">
          {isTaskType ? 'Revisions & Support' : 'Capacity & Scope'}
        </h2>
        <p className="step-description">
          {isTaskType
            ? 'Define revision rounds and post-delivery support.'
            : 'Set capacity limits and scope boundaries for the retainer.'}
        </p>
      </div>

      {/* Task-specific: Revision Rounds */}
      {isTaskType && (
        <div className="form-section">
          <h3 className="section-title">Revision Rounds</h3>
          <p className="section-hint">
            How many rounds of revisions are included in the price?
          </p>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Included Revisions</label>
              <Controller
                name="revisionRounds"
                control={control}
                render={({ field }) => (
                  <input
                    type="number"
                    className="input"
                    min="0"
                    max="10"
                    style={{ width: 100 }}
                    value={field.value || 0}
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                  />
                )}
              />
              <p className="form-hint">
                Set to 0 for unlimited revisions (not recommended).
              </p>
            </div>
          </div>

          {/* Revision Definition (for design) */}
          {isDesign && (
            <div className="form-group">
              <label className="form-label">What counts as a revision?</label>
              <p className="form-hint">
                Select which changes count toward revision rounds.
              </p>
              <div className="checkbox-grid">
                {REVISION_DEFINITIONS.map((def) => (
                  <label key={def.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={revisionDefinitions.includes(def.id)}
                      onChange={() => toggleRevisionDefinition(def.id)}
                    />
                    <span>{def.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Change Request Rule */}
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                {...register('changeRequestRule')}
              />
              <span>Changes beyond scope require a change request</span>
            </label>
            <p className="form-hint">
              If enabled, changes outside the original scope will be quoted separately.
            </p>
          </div>
        </div>
      )}

      {/* Development: Bug Fix Window */}
      {isTaskType && isDevelopment && (
        <div className="form-section">
          <h3 className="section-title">Post-Delivery Support</h3>
          <div className="form-group">
            <label className="form-label">Bug Fix Window (Days)</label>
            <Controller
              name="bugFixDays"
              control={control}
              render={({ field }) => (
                <input
                  type="number"
                  className="input"
                  min="0"
                  max="90"
                  style={{ width: 100 }}
                  value={field.value || 0}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                />
              )}
            />
            <p className="form-hint">
              How many days after delivery will you fix bugs at no extra cost?
            </p>
          </div>
        </div>
      )}

      {/* Retainer-specific: Scope Categories */}
      {isRetainerType && (
        <>
          <div className="form-section">
            <h3 className="section-title">Scope Categories</h3>
            <p className="section-hint">
              Define what types of work are included in the retainer.
            </p>

            <div className="add-item-row">
              <input
                type="text"
                className="input"
                placeholder="e.g., Bug fixes, Feature development, Meetings"
                value={newScopeCategory}
                onChange={(e) => setNewScopeCategory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addScopeCategory())}
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={addScopeCategory}>
                Add
              </button>
            </div>

            <div className="tags-list">
              {(scopeCategories as unknown as string[]).map((item, index) => (
                <span key={index} className="tag">
                  {typeof item === 'string' ? item : (item as any).value || ''}
                  <button type="button" className="tag-remove" onClick={() => removeScope(index)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="form-section">
            <h3 className="section-title">Monthly Capacity</h3>
            <div className="form-group">
              <label className="form-label">Capacity Description</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., Up to 20 hours, 4 design assets, 2 feature requests"
                {...register('monthlyCapacity')}
              />
              <p className="form-hint">
                Describe what's included each month. Leave blank for unlimited (not recommended).
              </p>
            </div>
          </div>

          <div className="form-section">
            <h3 className="section-title">Response Time</h3>
            <div className="form-group">
              <label className="form-label">Response Time (Business Days)</label>
              <Controller
                name="responseTimeDays"
                control={control}
                render={({ field }) => (
                  <input
                    type="number"
                    className="input"
                    min="0"
                    max="14"
                    style={{ width: 100 }}
                    value={field.value || 0}
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                  />
                )}
              />
              <p className="form-hint">
                Maximum time to respond to client requests.
              </p>
            </div>
          </div>
        </>
      )}

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

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .section-hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 12px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .checkbox-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 8px;
          margin-top: 12px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 13px;
        }

        .checkbox-label input {
          width: 16px;
          height: 16px;
        }

        .add-item-row {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }

        .add-item-row .input {
          flex: 1;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 13px;
        }

        .tag-remove {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 14px;
          line-height: 1;
          border-radius: 50%;
        }

        .tag-remove:hover {
          background: var(--bg-hover);
          color: var(--danger);
        }
      `}</style>
    </div>
  );
}
