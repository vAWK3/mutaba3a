import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Theme tokens and the Brand v2 fonts, the same files the app loads (MUT-102)
import '../styles/theme.css';
import '../index.css';
import './hosted.css';

import { PortalProviders } from './HostedApp';
import { createPortalQueryClient } from './queryClient';
import { createPortalRouter, type PortalRouter } from './router';
import { SENTRY_ENABLED, startErrorReporting } from './observability/errorReporting';

/** Entry of the hosted portal build (`vite --mode hosted`, hosted-portal.md §2). */

const started: { router?: PortalRouter } = {};
// MUT-149: first, so a crash while the portal starts is held for Sentry (signed in only)
startErrorReporting({ enabled: SENTRY_ENABLED, currentRouteId: () => started.router?.state.matches.at(-1)?.routeId });

const root = document.getElementById('root');
if (!root) throw new Error('hosted.html has no #root');

const queryClient = createPortalQueryClient();
const router = createPortalRouter(queryClient);
started.router = router;

createRoot(root).render(
  <StrictMode>
    <PortalProviders queryClient={queryClient} router={router} />
  </StrictMode>,
);
