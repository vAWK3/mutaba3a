import { LANGUAGE_CHOSEN_KEY, LANGUAGE_STORAGE_KEY, type Language } from '../lib/i18n';

/** Stores a language as a person's choice, the way the EN/AR switch leaves it (MUT-202). */
export function chooseLanguage(language: Language): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  localStorage.setItem(LANGUAGE_CHOSEN_KEY, '1');
}
