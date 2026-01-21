import { create } from 'zustand';
import type {
  EngagementType,
  EngagementCategory,
  EngagementLanguage,
  WizardStep,
  WizardMode,
} from '../types';

// Total number of steps in the wizard
export const TOTAL_STEPS = 9;

// Step labels for display
export const STEP_LABELS = [
  'Client Setup',
  'Summary',
  'Scope',
  'Timeline',
  'Reviews',
  'Payment',
  'Relationship',
  'Terms',
  'Review & Export',
] as const;

interface WizardState {
  // Core wizard state
  currentStep: WizardStep;
  mode: WizardMode;
  engagementId?: string;
  engagementType: EngagementType;
  engagementCategory: EngagementCategory;
  primaryLanguage: EngagementLanguage;

  // Tracking state
  isDirty: boolean;
  lastSavedAt?: string;
  isLoading: boolean;
  isSaving: boolean;

  // Prefill data
  prefillProfileId?: string;
  prefillClientId?: string;
  prefillProjectId?: string;

  // Visited steps (for validation)
  visitedSteps: Set<WizardStep>;

  // Actions
  setStep: (step: WizardStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  setEngagementId: (id: string) => void;
  setEngagementType: (type: EngagementType) => void;
  setEngagementCategory: (category: EngagementCategory) => void;
  setPrimaryLanguage: (language: EngagementLanguage) => void;
  setDirty: (dirty: boolean) => void;
  setLastSavedAt: (timestamp: string) => void;
  setIsLoading: (loading: boolean) => void;
  setIsSaving: (saving: boolean) => void;
  setPrefill: (options: { profileId?: string; clientId?: string; projectId?: string; type?: EngagementType }) => void;
  markStepVisited: (step: WizardStep) => void;
  canNavigateToStep: (step: WizardStep) => boolean;
  reset: () => void;
  initializeForEdit: (options: {
    engagementId: string;
    type: EngagementType;
    category: EngagementCategory;
    language: EngagementLanguage;
  }) => void;
}

const initialState = {
  currentStep: 0 as WizardStep,
  mode: 'create' as WizardMode,
  engagementId: undefined,
  engagementType: 'task' as EngagementType,
  engagementCategory: 'design' as EngagementCategory,
  primaryLanguage: 'en' as EngagementLanguage,
  isDirty: false,
  lastSavedAt: undefined,
  isLoading: false,
  isSaving: false,
  prefillProfileId: undefined,
  prefillClientId: undefined,
  prefillProjectId: undefined,
  visitedSteps: new Set([0 as WizardStep]),
};

export const useWizardStore = create<WizardState>((set, get) => ({
  ...initialState,

  setStep: (step) => {
    const state = get();
    if (state.canNavigateToStep(step)) {
      set({
        currentStep: step,
        visitedSteps: new Set([...state.visitedSteps, step]),
      });
    }
  },

  nextStep: () => {
    const { currentStep } = get();
    const nextStep = Math.min(currentStep + 1, TOTAL_STEPS - 1) as WizardStep;
    get().setStep(nextStep);
  },

  prevStep: () => {
    const { currentStep } = get();
    const prevStep = Math.max(currentStep - 1, 0) as WizardStep;
    set({ currentStep: prevStep });
  },

  setEngagementId: (id) => set({ engagementId: id }),

  setEngagementType: (type) => set({ engagementType: type }),

  setEngagementCategory: (category) => set({ engagementCategory: category }),

  setPrimaryLanguage: (language) => set({ primaryLanguage: language }),

  setDirty: (dirty) => set({ isDirty: dirty }),

  setLastSavedAt: (timestamp) => set({ lastSavedAt: timestamp }),

  setIsLoading: (loading) => set({ isLoading: loading }),

  setIsSaving: (saving) => set({ isSaving: saving }),

  setPrefill: (options) =>
    set({
      prefillProfileId: options.profileId,
      prefillClientId: options.clientId,
      prefillProjectId: options.projectId,
      engagementType: options.type || 'task',
    }),

  markStepVisited: (step) =>
    set((state) => ({
      visitedSteps: new Set([...state.visitedSteps, step]),
    })),

  canNavigateToStep: (step) => {
    const { visitedSteps, currentStep } = get();
    // Can always go back to visited steps
    if (visitedSteps.has(step)) return true;
    // Can only go forward one step at a time
    return step === currentStep + 1;
  },

  reset: () =>
    set({
      ...initialState,
      visitedSteps: new Set([0 as WizardStep]),
    }),

  initializeForEdit: (options) =>
    set({
      mode: 'edit',
      engagementId: options.engagementId,
      engagementType: options.type,
      engagementCategory: options.category,
      primaryLanguage: options.language,
      currentStep: 0 as WizardStep,
      // Mark all steps as visited for edit mode
      visitedSteps: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8] as WizardStep[]),
    }),
}));
