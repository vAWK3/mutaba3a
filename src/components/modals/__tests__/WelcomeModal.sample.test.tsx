import { describe, it, expect, beforeEach } from 'vitest';
import { chooseLanguage } from '../../../test/language';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils';
import { db } from '../../../db/database';
import { useSampleSessionStore } from '../../../demo/sampleSessionStore';
import { WelcomeModal } from '../WelcomeModal';

beforeEach(async () => {
  chooseLanguage('en');
  await db.businessProfiles.clear();
});

describe('WelcomeModal during the visitor sample', () => {
  it('opens on a first run with no business profile', async () => {
    useSampleSessionStore.setState({ status: 'none' });
    renderWithProviders(<WelcomeModal />);
    expect(await screen.findByText(/Welcome to Mutaba3a/i)).toBeInTheDocument();
  });

  it('stays closed while the sample is being prepared', async () => {
    useSampleSessionStore.setState({ status: 'preparing' });
    renderWithProviders(<WelcomeModal />);
    // Give the profiles query time to answer "none" before asserting nothing opened.
    await waitFor(async () => expect(await db.businessProfiles.count()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/Welcome to Mutaba3a/i)).toBeNull();
  });
});
