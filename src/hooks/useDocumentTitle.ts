import { useEffect } from 'react';

/**
 * Keeps the browser tab's title in step with `title` (MUT-77). The public
 * pages pass a translated title, so the tab follows the active language;
 * index.html keeps the Arabic default for crawlers and the first paint.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
