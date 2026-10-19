/**
 * MUT-179: the landing page opens in Arabic (ADR-077), and its Clients and
 * client-profile mocks show overdue ages of 3, 34, 158 and 227 days. Each reads
 * in its own form: 3 → "أيام" (few), 11–99 → "يومًا" (many), never "3 يوم".
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ClientsListMock } from '../components/mocks/ClientsListMock';
import { ClientProfileMock } from '../components/mocks/ClientProfileMock';
import { I18nProvider } from '../../../lib/i18n/core';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import type { Language } from '../../../lib/i18n';

function renderIn(language: Language, ui: ReactElement) {
  return render(
    <I18nProvider translations={{ en, ar }} language={language} setLanguage={() => {}}>
      {ui}
    </I18nProvider>
  );
}

describe('Landing mock day counts (MUT-179)', () => {
  it('words the Clients mock oldest-overdue ages in Arabic', () => {
    renderIn('ar', <ClientsListMock />);
    expect(screen.getByText('الأقدم 3 أيام')).toBeInTheDocument();
    expect(screen.getByText('الأقدم 227 يومًا')).toBeInTheDocument();
    expect(screen.getByText('الأقدم 158 يومًا')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+ يوم(?!ًا)/);
  });

  it('words the client-profile mock overdue badge in Arabic', () => {
    renderIn('ar', <ClientProfileMock />);
    expect(screen.getByText('متأخر 34 يومًا')).toBeInTheDocument();
  });

  it('keeps the terse English ages', () => {
    renderIn('en', <ClientsListMock />);
    expect(screen.getByText('oldest 3d')).toBeInTheDocument();
  });
});
