import { Controller, useFormContext } from 'react-hook-form';
import { cn } from '../../../../lib/utils';
import { useClients, useProjects, useBusinessProfiles, useDefaultBusinessProfile } from '../../../../hooks/useQueries';
import { useWizardStore } from '../../hooks/useWizardStore';
import type { EngagementSnapshot, EngagementType, EngagementCategory, EngagementLanguage } from '../../types';
import { useEffect } from 'react';

const ENGAGEMENT_TYPES: { value: EngagementType; label: string; description: string }[] = [
  {
    value: 'task',
    label: 'Task-Based',
    description: 'One-time project with defined deliverables and timeline',
  },
  {
    value: 'retainer',
    label: 'Retainer',
    description: 'Ongoing monthly agreement with recurring work',
  },
];

const ENGAGEMENT_CATEGORIES: { value: EngagementCategory; label: string }[] = [
  { value: 'design', label: 'Design' },
  { value: 'development', label: 'Development' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'legal', label: 'Legal' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'other', label: 'Other' },
];

const LANGUAGES: { value: EngagementLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic (العربية)' },
];

interface ClientSetupStepProps {
  className?: string;
}

export function ClientSetupStep({ className }: ClientSetupStepProps) {
  const { control, watch, setValue } = useFormContext<EngagementSnapshot>();
  const { engagementType, setEngagementType, engagementCategory, setEngagementCategory, primaryLanguage, setPrimaryLanguage, prefillProfileId } = useWizardStore();

  const { data: profiles = [] } = useBusinessProfiles();
  const { data: defaultProfile } = useDefaultBusinessProfile();
  const { data: clients = [] } = useClients();
  const selectedClientId = watch('clientId');
  const selectedProfileId = watch('profileId');
  const { data: projects = [] } = useProjects(selectedClientId || undefined);

  // Set default profile if not set
  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) {
      const targetProfile = prefillProfileId
        ? profiles.find(p => p.id === prefillProfileId)
        : defaultProfile || profiles[0];
      if (targetProfile) {
        setValue('profileId', targetProfile.id);
        setValue('profileName', targetProfile.name);
      }
    }
  }, [selectedProfileId, profiles, defaultProfile, prefillProfileId, setValue]);

  const handleProfileChange = (profileId: string) => {
    setValue('profileId', profileId);
    const profile = profiles.find((p) => p.id === profileId);
    setValue('profileName', profile?.name || '');
  };

  const handleClientChange = (clientId: string) => {
    setValue('clientId', clientId);
    const client = clients.find((c) => c.id === clientId);
    setValue('clientName', client?.name || '');
    // Clear project when client changes
    setValue('projectId', undefined);
    setValue('projectName', undefined);
  };

  const handleProjectChange = (projectId: string | undefined) => {
    setValue('projectId', projectId);
    const project = projects.find((p) => p.id === projectId);
    setValue('projectName', project?.name || undefined);
  };

  return (
    <div className={cn('wizard-step-content', className)}>
      <div className="step-header">
        <h2 className="step-title">Client Setup</h2>
        <p className="step-description">
          Choose your client and configure the engagement type.
        </p>
      </div>

      <div className="form-section">
        {/* Profile Selection */}
        <div className="form-group">
          <label className="form-label">Business Profile *</label>
          <Controller
            name="profileId"
            control={control}
            rules={{ required: 'Profile is required' }}
            render={({ field, fieldState }) => (
              <>
                <select
                  className={cn('select', fieldState.error && 'select-error')}
                  value={field.value || ''}
                  onChange={(e) => handleProfileChange(e.target.value)}
                >
                  <option value="">Select a profile...</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                {fieldState.error && (
                  <p className="form-error">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
          <p className="form-hint">The business profile used for this engagement document.</p>
        </div>

        {/* Client Selection */}
        <div className="form-group">
          <label className="form-label">Client *</label>
          <Controller
            name="clientId"
            control={control}
            rules={{ required: 'Client is required' }}
            render={({ field, fieldState }) => (
              <>
                <select
                  className={cn('select', fieldState.error && 'select-error')}
                  value={field.value || ''}
                  onChange={(e) => handleClientChange(e.target.value)}
                >
                  <option value="">Select a client...</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
                {fieldState.error && (
                  <p className="form-error">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
        </div>

        {/* Project Selection (Optional) */}
        {selectedClientId && projects.length > 0 && (
          <div className="form-group">
            <label className="form-label">Project (Optional)</label>
            <Controller
              name="projectId"
              control={control}
              render={({ field }) => (
                <select
                  className="select"
                  value={field.value || ''}
                  onChange={(e) => handleProjectChange(e.target.value || undefined)}
                >
                  <option value="">No specific project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
            />
            <p className="form-hint">Link this engagement to an existing project for better tracking.</p>
          </div>
        )}
      </div>

      <div className="form-section">
        <h3 className="section-title">Engagement Type</h3>
        <div className="type-selector">
          {ENGAGEMENT_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              className={cn(
                'type-option',
                engagementType === type.value && 'type-option-active'
              )}
              onClick={() => setEngagementType(type.value)}
            >
              <span className="type-option-label">{type.label}</span>
              <span className="type-option-description">{type.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-section">
        <h3 className="section-title">Category</h3>
        <div className="category-selector">
          {ENGAGEMENT_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              className={cn(
                'category-option',
                engagementCategory === cat.value && 'category-option-active'
              )}
              onClick={() => setEngagementCategory(cat.value)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-section">
        <h3 className="section-title">Document Language</h3>
        <div className="language-selector">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.value}
              type="button"
              className={cn(
                'language-option',
                primaryLanguage === lang.value && 'language-option-active'
              )}
              onClick={() => setPrimaryLanguage(lang.value)}
            >
              {lang.label}
            </button>
          ))}
        </div>
        <p className="form-hint">
          The engagement document will be generated in this language.
        </p>
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

        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 12px;
        }

        .type-selector {
          display: grid;
          gap: 12px;
        }

        .type-option {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 16px;
          background: var(--bg);
          border: 2px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
          text-align: left;
        }

        .type-option:hover {
          border-color: var(--primary);
        }

        .type-option-active {
          border-color: var(--primary);
          background: rgba(var(--primary-rgb), 0.05);
        }

        .type-option-label {
          font-weight: 500;
          font-size: 15px;
          margin-bottom: 4px;
        }

        .type-option-description {
          font-size: 13px;
          color: var(--text-muted);
        }

        .category-selector,
        .language-selector {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .category-option,
        .language-option {
          padding: 8px 16px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.15s ease;
        }

        .category-option:hover,
        .language-option:hover {
          border-color: var(--primary);
        }

        .category-option-active,
        .language-option-active {
          border-color: var(--primary);
          background: var(--primary);
          color: white;
        }
      `}</style>
    </div>
  );
}
