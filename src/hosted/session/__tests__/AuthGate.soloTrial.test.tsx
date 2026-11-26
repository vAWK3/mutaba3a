import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-731 (Basel Q7): the one-time Solo trial step shows before the shell when the server offers it. The gate marks
 * the shell as shown during the same render /v1/me first answers, so the step must keep it from being marked shown,
 * as the terms step does; otherwise it could never appear. The step is dark (SOLO_TRIAL_CHECKOUT off), so the switch
 * is turned on here.
 */
vi.mock('../../pages/onboarding/SoloTrialStep', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pages/onboarding/SoloTrialStep')>()),
  SOLO_TRIAL_CHECKOUT: true,
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Solo trial step at sign-in (MUT-731)', () => {
  it('shows before the shell when the server offers it', async () => {
    stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok({ ...me([profile()]), plan: { current: 'starter', businesses: null, soloTrialOffer: true } }),
      'POST /v1/billing/solo-trial/offered': () => ok({}),
    });
    renderPortal(`/p/${ORG_A}`);
    expect(await screen.findByTestId('solo-trial-step')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose how to start' })).toBeInTheDocument();
  });

  it('is not shown when the server does not offer it', async () => {
    stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok({ ...me([profile()]), plan: { current: 'starter', businesses: null, soloTrialOffer: false } }),
    });
    renderPortal(`/p/${ORG_A}`);
    expect(await screen.findByRole('main')).toBeInTheDocument();
    expect(screen.queryByTestId('solo-trial-step')).not.toBeInTheDocument();
  });
});
