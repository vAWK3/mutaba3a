import { useState, useEffect, useMemo } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import { useWizardStore } from '../../hooks/useWizardStore';
import type { EngagementSnapshot, Deliverable } from '../../types';
import { nanoid } from 'nanoid';
import {
  getScopeDefaults,
  resetToDefaults,
  getDeliverablePresets,
  createDeliverableFromPreset,
  shouldAutoApplyDefaults,
} from '../../services/defaultsService';

interface ScopeStepProps {
  className?: string;
}

export function ScopeStep({ className }: ScopeStepProps) {
  const { register, control, setValue, getValues } = useFormContext<EngagementSnapshot>();
  const { engagementCategory, primaryLanguage } = useWizardStore();

  const [newExclusion, setNewExclusion] = useState('');
  const [newDependency, setNewDependency] = useState('');
  const [showPresets, setShowPresets] = useState(true);

  const { fields: deliverables, append: appendDeliverable, remove: removeDeliverable } = useFieldArray({
    control,
    name: 'deliverables',
  });

  const { fields: exclusions, append: appendExclusion, remove: removeExclusion } = useFieldArray({
    control,
    name: 'exclusions' as any,
  });

  const { fields: dependencies, append: appendDependency, remove: removeDependency } = useFieldArray({
    control,
    name: 'dependencies' as any,
  });

  // Get deliverable presets for current category
  const deliverablePresets = useMemo(() => {
    return getDeliverablePresets(engagementCategory, primaryLanguage);
  }, [engagementCategory, primaryLanguage]);

  // Track which presets are already used
  const usedPresetIds = useMemo(() => {
    return new Set(deliverables.map(d => (d as Deliverable).presetId).filter(Boolean));
  }, [deliverables]);

  // Auto-apply defaults on first visit
  useEffect(() => {
    const currentDeps = getValues('dependencies') || [];
    const currentExcl = getValues('exclusions') || [];
    const defaultsApplied = getValues('defaultsApplied');

    if (shouldAutoApplyDefaults(currentDeps, currentExcl, defaultsApplied)) {
      const defaults = getScopeDefaults(engagementCategory, primaryLanguage);
      setValue('dependencies', defaults.dependencies as any);
      setValue('exclusions', defaults.exclusions as any);
      setValue('defaultsApplied', true);
    }
  }, [engagementCategory, primaryLanguage, getValues, setValue]);

  const addDeliverable = () => {
    appendDeliverable({
      id: nanoid(),
      description: '',
      quantity: 1,
      source: 'custom',
    } as Deliverable);
  };

  const addDeliverableFromPreset = (presetId: string) => {
    const deliverable = createDeliverableFromPreset(presetId, engagementCategory, primaryLanguage);
    if (deliverable) {
      appendDeliverable(deliverable);
    }
  };

  const addExclusion = () => {
    if (newExclusion.trim()) {
      appendExclusion(newExclusion.trim() as any);
      setNewExclusion('');
    }
  };

  const addDependency = () => {
    if (newDependency.trim()) {
      appendDependency(newDependency.trim() as any);
      setNewDependency('');
    }
  };

  const handleResetDefaults = () => {
    const defaults = resetToDefaults(engagementCategory, primaryLanguage);
    setValue('dependencies', defaults.dependencies as any);
    setValue('exclusions', defaults.exclusions as any);
    setValue('defaultsApplied', true);
  };

  return (
    <div className={cn('wizard-step-content', className)}>
      <div className="step-header">
        <h2 className="step-title">Scope of Work</h2>
        <p className="step-description">
          Define what's included and excluded from this engagement.
        </p>
      </div>

      {/* Deliverables */}
      <div className="form-section">
        <div className="section-header">
          <h3 className="section-title">Deliverables</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addDeliverable}>
            + Add Custom
          </button>
        </div>
        <p className="section-hint">
          List the specific outputs the client will receive.
        </p>

        {/* Deliverable Presets Panel */}
        {deliverablePresets.length > 0 && (
          <div className="presets-panel">
            <button
              type="button"
              className="presets-toggle"
              onClick={() => setShowPresets(!showPresets)}
            >
              <span className="presets-toggle-icon">{showPresets ? '▼' : '▶'}</span>
              Quick Add from Presets
            </button>
            {showPresets && (
              <div className="presets-grid">
                {deliverablePresets.map((preset) => {
                  const isUsed = usedPresetIds.has(preset.id);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={cn('preset-chip', isUsed && 'preset-chip-used')}
                      disabled={isUsed}
                      onClick={() => addDeliverableFromPreset(preset.id)}
                    >
                      {isUsed ? '✓ ' : '+ '}
                      {preset.displayText}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="deliverables-list">
          {deliverables.map((field, index) => (
            <div key={field.id} className="deliverable-row">
              <div className="deliverable-main">
                {(field as Deliverable).source === 'preset' && (
                  <span className="deliverable-badge" title="From preset">P</span>
                )}
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Homepage design mockup"
                  {...register(`deliverables.${index}.description` as const)}
                />
              </div>
              <input
                type="number"
                className="input input-sm"
                min="1"
                style={{ width: 80 }}
                placeholder="Qty"
                {...register(`deliverables.${index}.quantity` as const, { valueAsNumber: true })}
              />
              <input
                type="text"
                className="input input-sm"
                style={{ width: 100 }}
                placeholder="Format"
                {...register(`deliverables.${index}.format` as const)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => removeDeliverable(index)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          {deliverables.length === 0 && (
            <div className="empty-list">
              <p>No deliverables added yet.</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addDeliverable}>
                Add First Deliverable
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Exclusions */}
      <div className="form-section">
        <div className="section-header">
          <h3 className="section-title">Exclusions</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleResetDefaults}
            title="Reset to category defaults"
          >
            ↺ Reset Defaults
          </button>
        </div>
        <p className="section-hint">
          Clearly state what is NOT included to avoid scope creep.
        </p>

        <div className="add-item-row">
          <input
            type="text"
            className="input"
            placeholder="e.g., Ongoing maintenance, Third-party integrations"
            value={newExclusion}
            onChange={(e) => setNewExclusion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addExclusion())}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={addExclusion}>
            Add
          </button>
        </div>

        <div className="tags-list">
          {(exclusions as unknown as string[]).map((item, index) => (
            <span key={index} className="tag">
              {typeof item === 'string' ? item : (item as any).value || ''}
              <button type="button" className="tag-remove" onClick={() => removeExclusion(index)}>
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Dependencies */}
      <div className="form-section">
        <h3 className="section-title">Dependencies</h3>
        <p className="section-hint">
          What do you need from the client to proceed?
        </p>

        <div className="add-item-row">
          <input
            type="text"
            className="input"
            placeholder="e.g., Brand guidelines, Content copy, Server access"
            value={newDependency}
            onChange={(e) => setNewDependency(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDependency())}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={addDependency}>
            Add
          </button>
        </div>

        <div className="tags-list">
          {(dependencies as unknown as string[]).map((item, index) => (
            <span key={index} className="tag tag-dependency">
              {typeof item === 'string' ? item : (item as any).value || ''}
              <button type="button" className="tag-remove" onClick={() => removeDependency(index)}>
                ×
              </button>
            </span>
          ))}
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
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
        }

        .section-hint {
          color: var(--text-muted);
          font-size: 13px;
          margin: 0 0 12px;
        }

        /* Presets Panel */
        .presets-panel {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          margin-bottom: 16px;
          overflow: hidden;
        }

        .presets-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: var(--text);
          text-align: left;
        }

        .presets-toggle:hover {
          background: var(--bg-hover);
        }

        .presets-toggle-icon {
          font-size: 10px;
          color: var(--text-muted);
        }

        .presets-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 0 12px 12px;
        }

        .preset-chip {
          padding: 6px 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 16px;
          cursor: pointer;
          font-size: 12px;
          color: var(--text);
          transition: all 0.15s ease;
        }

        .preset-chip:hover:not(:disabled) {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.1);
        }

        .preset-chip-used {
          background: rgba(var(--success-rgb, 34, 197, 94), 0.1);
          border-color: var(--success, #22c55e);
          color: var(--success, #22c55e);
          cursor: default;
        }

        /* Deliverables */
        .deliverables-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .deliverable-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .deliverable-main {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .deliverable-main .input {
          flex: 1;
        }

        .deliverable-badge {
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

        .empty-list {
          padding: 24px;
          text-align: center;
          background: var(--bg-elevated);
          border-radius: 8px;
          border: 1px dashed var(--border);
        }

        .empty-list p {
          color: var(--text-muted);
          margin: 0 0 12px;
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

        .tag-dependency {
          background: rgba(var(--primary-rgb), 0.1);
          border-color: var(--primary);
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
