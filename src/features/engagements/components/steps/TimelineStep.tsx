import { useFormContext, useFieldArray, Controller } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import type { EngagementSnapshot, Milestone } from '../../types';
import { nanoid } from 'nanoid';
import {
  generateMilestonesFromDeliverables,
  isGeneratedMilestone,
} from '../../services/milestoneService';

interface TimelineStepProps {
  className?: string;
}

export function TimelineStep({ className }: TimelineStepProps) {
  const { register, control, watch, setValue, getValues } = useFormContext<EngagementSnapshot>();

  const { fields: milestones, append: appendMilestone, remove: removeMilestone, replace: replaceMilestones } = useFieldArray({
    control,
    name: 'milestones',
  });

  const deliverables = watch('deliverables') || [];
  const startDate = watch('startDate');
  const endDate = watch('endDate');
  const silenceEqualsApproval = watch('silenceEqualsApproval');

  const addMilestone = () => {
    appendMilestone({
      id: nanoid(),
      title: '',
      targetDate: undefined,
      deliverableIds: [],
      generated: false,
      userEdited: false,
    } as Milestone);
  };

  const handleGenerateFromDeliverables = () => {
    const currentMilestones = getValues('milestones') || [];
    const newMilestones = generateMilestonesFromDeliverables(
      deliverables,
      startDate,
      endDate,
      currentMilestones
    );
    replaceMilestones(newMilestones);
  };

  const handleMilestoneTitleChange = (index: number) => {
    const milestone = milestones[index] as Milestone;
    if (milestone.generated && !milestone.userEdited) {
      // Mark as user-edited
      setValue(`milestones.${index}.userEdited`, true);
    }
  };

  const handleMilestoneDateChange = (index: number) => {
    const milestone = milestones[index] as Milestone;
    if (milestone.generated && !milestone.userEdited) {
      // Mark as user-edited
      setValue(`milestones.${index}.userEdited`, true);
    }
  };

  const hasDeliverables = deliverables.length > 0;

  return (
    <div className={cn('wizard-step-content', className)}>
      <div className="step-header">
        <h2 className="step-title">Timeline & Milestones</h2>
        <p className="step-description">
          Set project dates and define key milestones for tracking progress.
        </p>
      </div>

      {/* Project Dates */}
      <div className="form-section">
        <h3 className="section-title">Project Dates</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input
              type="date"
              className="input"
              {...register('startDate')}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Target End Date</label>
            <input
              type="date"
              className="input"
              {...register('endDate')}
            />
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div className="form-section">
        <div className="section-header">
          <h3 className="section-title">Milestones</h3>
          <div className="section-actions">
            {hasDeliverables && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleGenerateFromDeliverables}
                title="Generate milestones from deliverables"
              >
                ⚡ Generate from Deliverables
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={addMilestone}>
              + Add Milestone
            </button>
          </div>
        </div>
        <p className="section-hint">
          Break the project into phases or checkpoints.
          {hasDeliverables && ' Click "Generate from Deliverables" to auto-create milestones.'}
        </p>

        <div className="milestones-list">
          {milestones.map((field, index) => {
            const milestone = field as Milestone;
            const isGenerated = isGeneratedMilestone(milestone);
            const wasEdited = milestone.userEdited;

            return (
              <div key={field.id} className={cn('milestone-card', isGenerated && !wasEdited && 'milestone-generated')}>
                <div className="milestone-header">
                  <div className="milestone-header-left">
                    <span className="milestone-number">#{index + 1}</span>
                    {isGenerated && (
                      <span className={cn('milestone-badge', wasEdited && 'milestone-badge-edited')}>
                        {wasEdited ? 'Auto (edited)' : 'Auto'}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => removeMilestone(index)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
                <div className="milestone-body">
                  <div className="form-group">
                    <input
                      type="text"
                      className="input"
                      placeholder="Milestone title (e.g., Design Phase Complete)"
                      {...register(`milestones.${index}.title` as const)}
                      onChange={(e) => {
                        handleMilestoneTitleChange(index);
                        register(`milestones.${index}.title` as const).onChange(e);
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label-sm">Target Date</label>
                    <input
                      type="date"
                      className="input"
                      {...register(`milestones.${index}.targetDate` as const)}
                      onChange={(e) => {
                        handleMilestoneDateChange(index);
                        register(`milestones.${index}.targetDate` as const).onChange(e);
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {milestones.length === 0 && (
            <div className="empty-list">
              <p>No milestones defined.</p>
              {hasDeliverables ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleGenerateFromDeliverables}
                >
                  Generate from Deliverables
                </button>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={addMilestone}>
                  Add First Milestone
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Review Window */}
      <div className="form-section">
        <h3 className="section-title">Client Review Period</h3>
        <p className="section-hint">
          How long does the client have to review deliverables before they're considered approved?
        </p>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Review Window (Days)</label>
            <Controller
              name="reviewWindowDays"
              control={control}
              render={({ field }) => (
                <input
                  type="number"
                  className="input"
                  min="0"
                  max="30"
                  style={{ width: 100 }}
                  value={field.value || 0}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                />
              )}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              {...register('silenceEqualsApproval')}
            />
            <span>Silence equals approval</span>
          </label>
          <p className="form-hint">
            {silenceEqualsApproval
              ? 'If the client doesn\'t respond within the review window, deliverables are considered approved.'
              : 'Explicit approval is required for each deliverable.'}
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
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
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
          margin: 0;
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

        .form-row .form-group {
          flex: 1;
          min-width: 150px;
        }

        .milestones-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .milestone-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
        }

        .milestone-generated {
          border-color: rgba(var(--primary-rgb), 0.3);
          background: rgba(var(--primary-rgb), 0.02);
        }

        .milestone-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--bg);
          border-bottom: 1px solid var(--border);
        }

        .milestone-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .milestone-number {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
        }

        .milestone-badge {
          font-size: 10px;
          padding: 2px 6px;
          background: rgba(var(--primary-rgb), 0.1);
          color: var(--primary);
          border-radius: 4px;
          font-weight: 500;
        }

        .milestone-badge-edited {
          background: rgba(var(--warning-rgb, 234, 179, 8), 0.1);
          color: var(--warning, #eab308);
        }

        .milestone-body {
          padding: 12px;
        }

        .milestone-body .form-group {
          margin-bottom: 8px;
        }

        .milestone-body .form-group:last-child {
          margin-bottom: 0;
        }

        .form-label-sm {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 4px;
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
          font-size: 13px;
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
