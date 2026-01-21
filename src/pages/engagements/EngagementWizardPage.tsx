import { useEffect, useMemo } from 'react';
import { useParams, useSearch, useNavigate } from '@tanstack/react-router';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TopBar } from '../../components/layout';
import { useClients, useBusinessProfiles } from '../../hooks/useQueries';
import { useToast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';

// Feature imports
import {
  useWizardStore,
  STEP_LABELS,
} from '../../features/engagements/hooks/useWizardStore';
import {
  useEngagement,
  useLatestVersion,
  useCreateEngagement,
  useSaveEngagementVersion,
  useFinalizeEngagement,
} from '../../features/engagements/hooks/useEngagementQueries';
import { useAutosave, loadAutosaveData, clearAutosaveData, isAutosaveRecent } from '../../features/engagements/hooks/useAutosave';
import { useClarityCheck } from '../../features/engagements/hooks/useClarityCheck';
import type { EngagementSnapshot } from '../../features/engagements/types';
import { DEFAULT_SNAPSHOT } from '../../features/engagements/types';
import { downloadEngagementPdf } from '../../features/engagements/pdf';

// Components
import { WizardProgress } from '../../features/engagements/components/WizardProgress';
import { WizardNavigation } from '../../features/engagements/components/WizardNavigation';
import { ClarityCheckPanel } from '../../features/engagements/components/ClarityCheckPanel';
import { EngagementPreview } from '../../features/engagements/components/EngagementPreview';
import { ClientSetupStep } from '../../features/engagements/components/steps/ClientSetupStep';
import { SummaryStep } from '../../features/engagements/components/steps/SummaryStep';
import { ScopeStep } from '../../features/engagements/components/steps/ScopeStep';
import { TimelineStep } from '../../features/engagements/components/steps/TimelineStep';
import { ReviewsStep } from '../../features/engagements/components/steps/ReviewsStep';
import { PaymentStep } from '../../features/engagements/components/steps/PaymentStep';
import { RelationshipStep } from '../../features/engagements/components/steps/RelationshipStep';
import { StandardTermsStep } from '../../features/engagements/components/steps/StandardTermsStep';
import { ReviewExportStep } from '../../features/engagements/components/steps/ReviewExportStep';

// Form validation schema
const engagementSchema = z.object({
  profileId: z.string().min(1, 'Profile is required'),
  profileName: z.string(),
  clientId: z.string().min(1, 'Client is required'),
  clientName: z.string(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  summary: z.string(),
  clientGoal: z.string().optional(),
  deliverables: z.array(z.object({
    id: z.string(),
    description: z.string(),
    quantity: z.number().optional(),
    format: z.string().optional(),
  })),
  exclusions: z.array(z.string()),
  dependencies: z.array(z.string()),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  milestones: z.array(z.object({
    id: z.string(),
    title: z.string(),
    targetDate: z.string().optional(),
    deliverableIds: z.array(z.string()),
  })),
  reviewWindowDays: z.number(),
  silenceEqualsApproval: z.boolean(),
  revisionRounds: z.number(),
  revisionDefinition: z.array(z.string()),
  bugFixDays: z.number().optional(),
  changeRequestRule: z.boolean(),
  scopeCategories: z.array(z.string()).optional(),
  monthlyCapacity: z.string().optional(),
  responseTimeDays: z.number().optional(),
  currency: z.enum(['USD', 'ILS', 'EUR']),
  totalAmountMinor: z.number().optional(),
  depositPercent: z.number().optional(),
  scheduleItems: z.array(z.object({
    id: z.string(),
    label: z.string(),
    trigger: z.enum(['on_signing', 'on_milestone', 'on_completion', 'monthly']),
    milestoneId: z.string().optional(),
    amountMinor: z.number(),
    currency: z.enum(['USD', 'ILS', 'EUR']),
  })),
  lateFeeEnabled: z.boolean(),
  retainerAmountMinor: z.number().optional(),
  billingDay: z.number().optional(),
  rolloverRule: z.enum(['none', 'carry', 'expire']).optional(),
  outOfScopeRateMinor: z.number().optional(),
  termType: z.enum(['fixed', 'month-to-month']),
  terminationNoticeDays: z.number(),
  cancellationCoveragePercent: z.number().optional(),
  ownershipTransferRule: z.string(),
  confidentiality: z.boolean(),
  ipOwnership: z.boolean(),
  warrantyDisclaimer: z.boolean(),
  limitationOfLiability: z.boolean(),
  nonSolicitation: z.boolean(),
  disputePath: z.enum(['negotiation', 'mediation', 'arbitration']),
  governingLaw: z.string().optional(),
});

export function EngagementWizardPage() {
  const params = useParams({ strict: false }) as { engagementId?: string };
  const searchParams = useSearch({ strict: false }) as { profileId?: string; clientId?: string; type?: 'task' | 'retainer' };
  const navigate = useNavigate();

  const engagementId = params.engagementId;
  const isEditMode = !!engagementId;

  // Store state
  const {
    currentStep,
    mode,
    engagementType,
    engagementCategory,
    primaryLanguage,
    isDirty,
    isSaving,
    setDirty,
    setLastSavedAt,
    setIsSaving,
    setPrefill,
    initializeForEdit,
    reset: resetStore,
    setEngagementId,
  } = useWizardStore();

  // Queries
  const { data: existingEngagement } = useEngagement(engagementId || '');
  const { data: latestVersion } = useLatestVersion(engagementId || '');
  const { data: clients = [] } = useClients();
  const { data: profiles = [] } = useBusinessProfiles();

  // Mutations
  const createEngagement = useCreateEngagement();
  const saveVersion = useSaveEngagementVersion();
  const finalize = useFinalizeEngagement();

  // Toast notifications
  const { showToast } = useToast();

  // Form setup
  const methods = useForm<EngagementSnapshot>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(engagementSchema) as any,
    defaultValues: DEFAULT_SNAPSHOT,
    mode: 'onChange',
  });

  const { watch, reset: resetForm, setValue } = methods;
  const formValues = watch();

  // Clarity check
  const risks = useClarityCheck(formValues, engagementType, engagementCategory);

  // Get client for preview
  const selectedClient = useMemo(() => {
    return clients.find((c) => c.id === formValues.clientId);
  }, [clients, formValues.clientId]);

  // Get profile for PDF generation
  const selectedProfile = useMemo(() => {
    return profiles.find((p) => p.id === formValues.profileId);
  }, [profiles, formValues.profileId]);

  // Autosave
  useAutosave(engagementId, formValues, isDirty, setLastSavedAt);

  // Initialize from URL params or autosave
  useEffect(() => {
    if (!isEditMode) {
      // Check for autosave first
      const autosaveData = loadAutosaveData();
      if (autosaveData && !autosaveData.engagementId && isAutosaveRecent()) {
        // Restore autosaved data for new engagement
        resetForm({ ...DEFAULT_SNAPSHOT, ...autosaveData.snapshot });
        setDirty(true);
      } else {
        // Apply URL prefills
        if (searchParams.profileId) {
          setPrefill({ profileId: searchParams.profileId });
        }
        if (searchParams.clientId) {
          const client = clients.find((c) => c.id === searchParams.clientId);
          if (client) {
            setValue('clientId', client.id);
            setValue('clientName', client.name);
          }
        }
        if (searchParams.type) {
          setPrefill({ type: searchParams.type });
        }
      }
    }
  }, [isEditMode, searchParams, clients, resetForm, setValue, setPrefill, setDirty]);

  // Initialize from existing engagement in edit mode
  useEffect(() => {
    if (isEditMode && existingEngagement && latestVersion) {
      initializeForEdit({
        engagementId: existingEngagement.id,
        type: existingEngagement.type,
        category: existingEngagement.category,
        language: existingEngagement.primaryLanguage,
      });
      resetForm(latestVersion.snapshot);
    }
  }, [isEditMode, existingEngagement, latestVersion, initializeForEdit, resetForm]);

  // Track form changes
  useEffect(() => {
    const subscription = watch(() => {
      if (!isDirty) {
        setDirty(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [watch, isDirty, setDirty]);

  // Handle save draft
  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      let currentEngagementId = engagementId;

      // Create engagement if new
      if (!currentEngagementId) {
        const newEngagement = await createEngagement.mutateAsync({
          profileId: formValues.profileId,
          clientId: formValues.clientId,
          projectId: formValues.projectId,
          type: engagementType,
          category: engagementCategory,
          primaryLanguage,
          status: 'draft',
        });
        currentEngagementId = newEngagement.id;
        setEngagementId(currentEngagementId);
        // Update URL without navigation
        window.history.replaceState({}, '', `/engagements/${currentEngagementId}/edit`);
      }

      // Save version
      await saveVersion.mutateAsync({
        engagementId: currentEngagementId,
        snapshot: formValues,
        status: 'draft',
      });

      setDirty(false);
      setLastSavedAt(new Date().toISOString());
      clearAutosaveData();
    } catch (error) {
      console.error('Failed to save draft:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle finalize
  const handleFinalize = async () => {
    setIsSaving(true);
    try {
      let currentEngagementId = engagementId;

      // Create engagement if new
      if (!currentEngagementId) {
        const newEngagement = await createEngagement.mutateAsync({
          profileId: formValues.profileId,
          clientId: formValues.clientId,
          projectId: formValues.projectId,
          type: engagementType,
          category: engagementCategory,
          primaryLanguage,
          status: 'draft',
        });
        currentEngagementId = newEngagement.id;
      }

      // Finalize
      await finalize.mutateAsync({
        engagementId: currentEngagementId,
        snapshot: formValues,
      });

      // Generate and download PDF
      const pdfResult = await downloadEngagementPdf({
        snapshot: formValues,
        client: selectedClient,
        language: primaryLanguage,
        type: engagementType,
        category: engagementCategory,
        profile: selectedProfile,
      });

      if (pdfResult.success) {
        clearAutosaveData();
        showToast('Engagement finalized and PDF downloaded');
        navigate({ to: '/engagements' });
      } else {
        // PDF failed but engagement is finalized - show error and stay on page
        console.error('PDF generation failed:', pdfResult.error);
        showToast('Engagement saved but PDF download failed. Please try downloading again.');
      }
    } catch (error) {
      console.error('Failed to finalize:', error);
      showToast('Failed to finalize engagement. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <ClientSetupStep />;
      case 1:
        return <SummaryStep />;
      case 2:
        return <ScopeStep />;
      case 3:
        return <TimelineStep />;
      case 4:
        return <ReviewsStep />;
      case 5:
        return <PaymentStep />;
      case 6:
        return <RelationshipStep />;
      case 7:
        return <StandardTermsStep />;
      case 8:
        return (
          <ReviewExportStep
            risks={risks}
            onFinalize={handleFinalize}
            isProcessing={isSaving}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <TopBar
        title={isEditMode ? 'Edit Engagement' : 'New Engagement'}
        breadcrumbs={[
          { label: 'Engagements', href: '/engagements' },
          { label: isEditMode ? 'Edit' : 'New' },
        ]}
      />

      <div className="page-content">
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <WizardProgress risks={risks} />

            <div className="wizard-layout">
              {/* Left: Form */}
              <div className="wizard-form">
                {renderStep()}
                {currentStep < 8 && (
                  <WizardNavigation
                    onSaveDraft={handleSaveDraft}
                    onFinalize={handleFinalize}
                    isSaving={isSaving}
                    isValid={true}
                  />
                )}
              </div>

              {/* Right: Preview & Clarity Check */}
              <div className="wizard-sidebar">
                <div className="sidebar-section">
                  <h3 className="sidebar-title">Clarity Check</h3>
                  <ClarityCheckPanel risks={risks} />
                </div>

                <div className="sidebar-section preview-section">
                  <h3 className="sidebar-title">Preview</h3>
                  <div className="preview-container">
                    <EngagementPreview
                      snapshot={formValues}
                      client={selectedClient}
                      language={primaryLanguage}
                    />
                  </div>
                </div>
              </div>
            </div>
          </form>
        </FormProvider>
      </div>

      <style>{`
        .wizard-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
        }

        @media (min-width: 1200px) {
          .wizard-layout {
            grid-template-columns: 1fr 400px;
          }
        }

        .wizard-form {
          min-width: 0;
        }

        .wizard-sidebar {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .sidebar-section {
          background: var(--bg-elevated);
          border-radius: 8px;
          overflow: hidden;
        }

        .sidebar-title {
          font-size: 13px;
          font-weight: 600;
          padding: 12px 16px;
          margin: 0;
          border-bottom: 1px solid var(--border);
          background: var(--bg);
        }

        .preview-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 400px;
        }

        .preview-container {
          flex: 1;
          overflow: hidden;
          background: white;
        }

        @media (max-width: 1199px) {
          .wizard-sidebar {
            display: none;
          }
        }
      `}</style>
    </>
  );
}
