import { useEffect, useRef } from 'react';

/**
 * Moves focus to the element once, when it mounts (MUT-149 design D7): a
 * screen that replaces the page, such as a crash card, puts keyboard and
 * screen-reader users on its title. The element needs `tabIndex={-1}`.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
