/**
 * MUT-24: a search with no match shows real copy, not raw keys. The page asked
 * for `projects.emptyFiltered`, `projects.emptyFilteredCount` and
 * `projects.clearSearch`, which did not exist, and `t()` returns the key on a
 * miss, so the `|| 'fallback'` beside each call never ran. Real dictionaries here
 * (ProjectsPage.test.tsx mocks `t`, which is how this went unseen).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '../../../test/utils';
import { chooseLanguage } from '../../../test/language';
import * as useQueries from '../../../hooks/useQueries';
import { ProjectsPage } from '../ProjectsPage';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('../../../components/layout', () => ({ TopBar: () => null }));
vi.mock('../../../hooks/useActiveProfile', () => ({ useProfileFilter: () => 'p-1' }));

function withProjects(count: number) {
  const all = Array.from({ length: count }, (_, i) => ({ id: `pr-${i}`, name: `Project ${i}` }));
  vi.spyOn(useQueries, 'useProjects').mockReturnValue({ data: all } as unknown as ReturnType<typeof useQueries.useProjects>);
  vi.spyOn(useQueries, 'useProjectSummaries').mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useQueries.useProjectSummaries>);
}

const SEARCH = { en: 'Search projects...', ar: 'بحث في المشاريع...' };

async function searchFor(text: string, language: keyof typeof SEARCH = 'en') {
  await userEvent.type(screen.getByPlaceholderText(SEARCH[language]), text);
}

describe('ProjectsPage search with no match', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('says nothing matched, how many projects exist, and offers to clear the search', async () => {
    withProjects(3);
    renderWithProviders(<ProjectsPage />);
    await searchFor('zzz');
    expect(await screen.findByText('No projects match your search')).toBeInTheDocument();
    expect(screen.getByText('3 projects in total.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('uses the singular for one project', async () => {
    withProjects(1);
    renderWithProviders(<ProjectsPage />);
    await searchFor('zzz');
    expect(await screen.findByText('1 project in total.')).toBeInTheDocument();
  });

  it('clears the search from the empty state', async () => {
    withProjects(2);
    renderWithProviders(<ProjectsPage />);
    await searchFor('zzz');
    await userEvent.click(await screen.findByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByPlaceholderText(SEARCH.en)).toHaveValue(''));
  });

  it('is in Arabic, with the Arabic plural, when Arabic is chosen', async () => {
    chooseLanguage('ar');
    withProjects(2);
    renderWithProviders(<ProjectsPage />);
    await searchFor('zzz', 'ar');
    expect(await screen.findByText('لا توجد مشاريع مطابقة للبحث')).toBeInTheDocument();
    expect(screen.getByText('مشروعان إجمالاً.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مسح البحث' })).toBeInTheDocument();
  });
});
