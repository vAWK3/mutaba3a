import { useFormContext } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import type { EngagementSnapshot } from '../../types';

interface SummaryStepProps {
  className?: string;
}

export function SummaryStep({ className }: SummaryStepProps) {
  const { register, formState: { errors } } = useFormContext<EngagementSnapshot>();

  return (
    <div className={cn('wizard-step-content', className)}>
      <div className="step-header">
        <h2 className="step-title">Project Summary</h2>
        <p className="step-description">
          Provide a clear title and summary that will appear at the top of the engagement document.
        </p>
      </div>

      <div className="form-section">
        {/* Title */}
        <div className="form-group">
          <label className="form-label">Engagement Title *</label>
          <input
            type="text"
            className={cn('input', errors.title && 'input-error')}
            placeholder="e.g., Website Redesign Project"
            {...register('title', { required: 'Title is required' })}
          />
          {errors.title && (
            <p className="form-error">{errors.title.message}</p>
          )}
          <p className="form-hint">
            A clear, descriptive title for this engagement.
          </p>
        </div>

        {/* Summary */}
        <div className="form-group">
          <label className="form-label">Project Summary *</label>
          <textarea
            className={cn('textarea', errors.summary && 'textarea-error')}
            rows={5}
            placeholder="Describe the project scope and objectives in a few sentences..."
            {...register('summary', { required: 'Summary is required' })}
          />
          {errors.summary && (
            <p className="form-error">{errors.summary.message}</p>
          )}
          <p className="form-hint">
            This summary helps set expectations and appears prominently in the document.
          </p>
        </div>

        {/* Client Goal (Optional) */}
        <div className="form-group">
          <label className="form-label">Client's Goal (Optional)</label>
          <textarea
            className="textarea"
            rows={3}
            placeholder="What is the client trying to achieve? What problem are you solving?"
            {...register('clientGoal')}
          />
          <p className="form-hint">
            Understanding the client's goal helps align expectations and demonstrates you understand their needs.
          </p>
        </div>
      </div>

      <style>{`
        .wizard-step-content {
          max-width: 600px;
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

        .textarea {
          min-height: 100px;
          resize: vertical;
        }
      `}</style>
    </div>
  );
}
