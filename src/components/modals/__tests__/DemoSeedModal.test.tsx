import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '../../../test/utils';
import { db } from '../../../db/database';
import { useDemoStore, getDemoProfileIds } from '../../../demo';
import { useProfileStore } from '../../../lib/profileStore';
import { useActiveProfile } from '../../../hooks/useActiveProfile';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { DemoSeedModal } from '../DemoSeedModal';

/**
 * MUT-220: after Show Demo the summary must render (activateDemo used to close the dialog first), and the demo
 * business must stay active (useActiveProfile's repair used to switch back before the profiles query refetched).
 */

const now = '2026-10-15T00:00:00.000Z';
const { seedDemoData } = vi.hoisted(() => ({ seedDemoData: vi.fn() }));
vi.mock('../../../demo/seedData', async (importOriginal) => ({ ...(await importOriginal<object>()), seedDemoData }));

const copy = en.demo;

/** What AppShell does: the dialog is mounted while the store's showConfirmModal is true. */
function Shell() {
  const show = useDemoStore((s) => s.showConfirmModal);
  const { activeProfileId } = useActiveProfile();
  return (
    <>
      <output data-testid="active">{activeProfileId}</output>
      {show && <DemoSeedModal onClose={() => useDemoStore.getState().setShowConfirmModal(false)} />}
    </>
  );
}

beforeEach(async () => {
  localStorage.clear();
  await Promise.all(db.tables.map((t) => t.clear()));
  useDemoStore.getState().deactivateDemo();
  useProfileStore.getState().reset();
  await db.businessProfiles.add({ id: 'bp-own', name: 'Own', isDefault: true, defaultCurrency: 'USD', createdAt: now, updatedAt: now });
  seedDemoData.mockReset().mockImplementation(async () => {
    await db.businessProfiles.bulkAdd(getDemoProfileIds().map((id) => ({ id, name: id, isDefault: false, defaultCurrency: 'ILS', createdAt: now, updatedAt: now })));
    return { clients: 10, projects: 15, transactions: 60, expenses: 25, expenseCategories: 5, recurringRules: 2, businessProfiles: 3, featuresEnabled: [] };
  });
});

async function showDemo() {
  useDemoStore.getState().setShowConfirmModal(true);
  renderWithProviders(<Shell />);
  await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('bp-own'));
  await userEvent.click(screen.getByRole('button', { name: copy.modal.seedButton }));
}

describe('DemoSeedModal (MUT-220)', () => {
  it('shows the summary, with the number of businesses seeded, before the dialog closes', async () => {
    await showDemo();

    expect(await screen.findByText(copy.modal.successTitle)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(`3${copy.stats.businesses}`);
    expect(useDemoStore.getState().isActive).toBe(true);
  });

  it('leaves the first demo business active, not the person\'s own', async () => {
    await showDemo();
    await screen.findByText(copy.modal.successTitle);

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent(getDemoProfileIds()[0]));
    expect(useProfileStore.getState().activeProfileId).toBe(getDemoProfileIds()[0]);
  });

  it('says how many businesses it will create, in both languages', () => {
    useDemoStore.getState().setShowConfirmModal(true);
    renderWithProviders(<Shell />);
    expect(screen.getByText(copy.modal.item.profile.replace('{count}', '3'))).toBeInTheDocument();
    expect(en.demo.modal.item.profile).toContain('{count}');
    expect(ar.demo.modal.item.profile).toContain('{count}');
  });
});
