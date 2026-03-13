import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OnboardingStep = 'client' | 'project' | 'income' | 'complete';

export interface OnboardingState {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  createdClientId?: string;
  createdProjectId?: string;
  skipped: boolean;

  // Actions
  startOnboarding: () => void;
  completeStep: (step: OnboardingStep, entityId?: string) => void;
  skipOnboarding: () => void;
  resetOnboarding: () => void;

  // Computed helpers
  isStepComplete: (step: OnboardingStep) => boolean;
  isOnboardingComplete: () => boolean;
}

const STEP_ORDER: OnboardingStep[] = ['client', 'project', 'income', 'complete'];

function getNextStep(currentStep: OnboardingStep): OnboardingStep {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  if (currentIndex < STEP_ORDER.length - 1) {
    return STEP_ORDER[currentIndex + 1];
  }
  return 'complete';
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      currentStep: 'client',
      completedSteps: [],
      skipped: false,

      startOnboarding: () =>
        set({
          currentStep: 'client',
          completedSteps: [],
          createdClientId: undefined,
          createdProjectId: undefined,
          skipped: false,
        }),

      completeStep: (step, entityId) =>
        set((state) => {
          // Don't duplicate completed steps
          if (state.completedSteps.includes(step)) {
            return state;
          }

          const newCompletedSteps = [...state.completedSteps, step];
          const nextStep = getNextStep(step);

          const updates: Partial<OnboardingState> = {
            completedSteps: newCompletedSteps,
            currentStep: nextStep,
          };

          // Store entity IDs for prefilling later drawers
          if (step === 'client' && entityId) {
            updates.createdClientId = entityId;
          } else if (step === 'project' && entityId) {
            updates.createdProjectId = entityId;
          }

          return { ...state, ...updates };
        }),

      skipOnboarding: () => set({ skipped: true }),

      resetOnboarding: () =>
        set({
          currentStep: 'client',
          completedSteps: [],
          createdClientId: undefined,
          createdProjectId: undefined,
          skipped: false,
        }),

      isStepComplete: (step) => get().completedSteps.includes(step),

      isOnboardingComplete: () => {
        const { completedSteps } = get();
        const requiredSteps: OnboardingStep[] = ['client', 'project', 'income'];
        return requiredSteps.every((step) => completedSteps.includes(step));
      },
    }),
    {
      name: 'onboarding-storage',
      partialize: (state) => ({
        currentStep: state.currentStep,
        completedSteps: state.completedSteps,
        createdClientId: state.createdClientId,
        createdProjectId: state.createdProjectId,
        skipped: state.skipped,
      }),
    }
  )
);
