import type { ReactNode } from 'react';
import { Navigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { meQuery } from '../../session/me';
import { useMode } from '../../session/mode';
import { CheckingSession } from './BootScreens';

/**
 * /signup and /recover are for someone signed out (MUT-368): a signed-in person who opens one goes Home. Signed out,
 * /v1/me is the local person, so only the server is asked (MUT-286), as sign-in does.
 */
export function SignedOutOnly({ children }: { children: ReactNode }) {
  const remote = useMode() === 'remote';
  const session = useQuery({ ...meQuery, enabled: remote });
  if (!remote) return children;
  if (session.isPending) return <CheckingSession />;
  if (session.data) return <Navigate to="/" replace />;
  return children;
}
