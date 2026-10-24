import type { Language } from './types';

const LANGUAGES: readonly Language[] = ['en', 'ar'];

/**
 * The `?lang` a link names (MUT-324 review fix 1, MUT-356, MUT-369): the language of the page or app the person
 * came from. It wins for what the link opens and is never stored. Null when absent or not a language we write.
 */
export function linkedLanguageOf(search: string): Language | null {
  const lang = new URLSearchParams(search).get('lang');
  return LANGUAGES.find((l) => l === lang) ?? null;
}

interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
}
interface HistoryLike {
  state: unknown;
  replaceState(data: unknown, unused: string, url?: string): void;
}

/**
 * Reads a link's `?lang` once, at the portal's start, and takes it off the address (MUT-369 D15), so a reload after
 * the person switches language keeps their switch instead of the link's. Call before the router reads the URL.
 */
export function takeLinkedLanguage(location: LocationLike = window.location, history: HistoryLike = window.history): Language | null {
  const params = new URLSearchParams(location.search);
  if (!params.has('lang')) return null;
  const language = linkedLanguageOf(location.search);
  params.delete('lang');
  const rest = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  return language;
}
