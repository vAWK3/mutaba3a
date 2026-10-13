import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocumentTitle } from '../useDocumentTitle';

beforeEach(() => {
  document.title = 'متابعة';
});

describe('useDocumentTitle', () => {
  it('sets the tab title and follows it when it changes', () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Mutaba3a — Privacy Policy' },
    });
    expect(document.title).toBe('Mutaba3a — Privacy Policy');

    rerender({ title: 'متابعة — سياسة الخصوصية' });
    expect(document.title).toBe('متابعة — سياسة الخصوصية');
  });
});
