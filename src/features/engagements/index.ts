// Feature exports for engagements

// Types
export * from './types';

// Repository
export { engagementRepo } from './db/engagementRepository';

// Hooks
export {
  useEngagements,
  useEngagement,
  useEngagementVersions,
  useCreateEngagement,
  useUpdateEngagement,
  useSaveEngagementVersion,
  useFinalizeEngagement,
  useArchiveEngagement,
  engagementQueryKeys,
} from './hooks/useEngagementQueries';

export { useWizardStore } from './hooks/useWizardStore';
export { useAutosave } from './hooks/useAutosave';
export { useClarityCheck } from './hooks/useClarityCheck';

// PDF
export { EngagementPdf } from './pdf';
export { getTexts as getEngagementTexts, getEngagementTypeLabel, getCategoryLabel } from './pdf/texts';
