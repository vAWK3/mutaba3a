import { useEffect, useState } from 'react';
import { setLocalStopHandler, type LocalStopCode } from '../api/client';

/**
 * MUT-286 review: the local backend stopped (a save the browser refused, or
 * another tab's newer format), so this page must not show or take another
 * record until a reload. The root layout renders the reload screen in place
 * of every route while this is set.
 */
export function useLocalStop(): LocalStopCode | null {
  const [stopped, setStopped] = useState<LocalStopCode | null>(null);
  useEffect(() => setLocalStopHandler(setStopped), []);
  return stopped;
}
