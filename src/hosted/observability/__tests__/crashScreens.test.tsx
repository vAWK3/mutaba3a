import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ORG_A, emptyProfileRoutes, me, ok, renderPortal, stubApi } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { ThemeProvider } from '../../../lib/theme';
import { HostedLanguageProvider } from '../../i18n/HostedLanguageProvider';
import { ReloadToContinue } from '../../pages/auth/BootScreens';
import { CrashCard } from '../../components/QueryView';

/**
 * MUT-149 design D3–D7 through the real portal: a page that crashes shows the
 * translated card in place of the page with the shell still there, the title
 * takes focus, nothing of the error's own text is shown, and the crash is
 * reported once (the router's own boundary, eng R2).
 */

const { crash, reportBoundaryError } = vi.hoisted(() => ({ crash: { page: false, shell: false }, reportBoundaryError: vi.fn() }));

vi.mock('../errorReporting', () => ({ reportBoundaryError, setReporterUser: vi.fn() }));
vi.mock('../../pages/views/ClientsPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../pages/views/ClientsPage')>();
  return {
    ...actual,
    ClientsPage: (props: Parameters<typeof actual.ClientsPage>[0]) => {
      if (crash.page) throw new TypeError('secret detail: Cannot read properties of undefined');
      return actual.ClientsPage(props);
    },
  };
});
vi.mock('../../shell/HostedShell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shell/HostedShell')>();
  return {
    ...actual,
    HostedShell: (props: Parameters<typeof actual.HostedShell>[0]) => {
      if (crash.shell) throw new Error('shell broke');
      return actual.HostedShell(props);
    },
  };
});

const COPY = {
  en: { title: 'This page stopped working', reload: 'Reload' },
  ar: { title: 'توقفت هذه الصفحة عن العمل', reload: 'إعادة التحميل' },
};

beforeEach(() => {
  crash.page = false;
  crash.shell = false;
  reportBoundaryError.mockClear();
  // React logs every caught render error; the test asserts on what the person sees instead
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function signedIn(language: 'en' | 'ar') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me(undefined, language)) });
}

describe('a page crash (design D3: inline, the shell stays)', () => {
  it.each(['en', 'ar'] as const)('shows the translated card in place of the page, with the navigation still there (%s)', async (language) => {
    signedIn(language);
    crash.page = true;
    renderPortal(`/p/${ORG_A}/clients`);
    const title = await screen.findByRole('heading', { name: COPY[language].title });
    // MUT-426: the chrome is one landmark named for the product, with the pill's Sections nav inside it.
    expect(screen.getByRole('navigation', { name: language === 'ar' ? 'الأقسام' : 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY[language].reload })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret detail');
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('reports the crash once, with the component stack', async () => {
    signedIn('en');
    crash.page = true;
    renderPortal(`/p/${ORG_A}/clients`);
    await screen.findByRole('heading', { name: COPY.en.title });
    expect(reportBoundaryError).toHaveBeenCalledTimes(1);
    const [error, componentStack] = reportBoundaryError.mock.calls[0];
    expect(error).toBeInstanceOf(TypeError);
    expect(typeof componentStack === 'string' || componentStack === undefined).toBe(true);
  });

  it('clears when the person navigates to another section', async () => {
    signedIn('en');
    crash.page = true;
    const { user } = renderPortal(`/p/${ORG_A}/clients`);
    await screen.findByRole('heading', { name: COPY.en.title });
    crash.page = false;
    await user.click(screen.getByRole('link', { name: 'Paid' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: COPY.en.title })).not.toBeInTheDocument());
  });
});

describe('a frame crash (design D3: the whole page)', () => {
  it('shows the full-page card with the wordmark when the shell itself crashes', async () => {
    signedIn('ar');
    crash.shell = true;
    renderPortal(`/p/${ORG_A}/clients`);
    await screen.findByRole('heading', { name: COPY.ar.title });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(reportBoundaryError).toHaveBeenCalledTimes(1);
  });
});

describe('the crash cards on their own (design D4, D7)', () => {
  const wrap = (ui: React.ReactNode, language: 'en' | 'ar') => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
    return render(
      <ThemeProvider>
        <HostedLanguageProvider>{ui}</HostedLanguageProvider>
      </ThemeProvider>,
    );
  };

  it.each(['en', 'ar'] as const)('ReloadToContinue CRASH: title focused, Tab reaches Reload (%s)', async (language) => {
    wrap(<ReloadToContinue stop="CRASH" />, language);
    const title = screen.getByRole('heading', { name: COPY[language].title });
    expect(document.activeElement).toBe(title);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: COPY[language].reload }));
  });

  it('CrashCard: title focused, one Reload', () => {
    wrap(<CrashCard />, 'en');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: COPY.en.title }));
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('keeps the local stops on their own copy and button', () => {
    wrap(<ReloadToContinue stop="LOCAL_SAVE_FAILED" />, 'en');
    expect(screen.queryByRole('heading', { name: COPY.en.title })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
