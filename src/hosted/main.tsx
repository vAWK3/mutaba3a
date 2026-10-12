import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Theme tokens and the Brand v2 fonts, the same files the app loads (MUT-102)
import '../styles/theme.css';
import '../index.css';
import './hosted.css';

import { PortalProviders } from './HostedApp';
import { createPortalQueryClient } from './queryClient';
import { createPortalRouter } from './router';

/** Entry of the hosted portal build (`vite --mode hosted`, hosted-portal.md §2). */

const root = document.getElementById('root');
if (!root) throw new Error('hosted.html has no #root');

const queryClient = createPortalQueryClient();
const router = createPortalRouter(queryClient);

createRoot(root).render(
  <StrictMode>
    <PortalProviders queryClient={queryClient} router={router} />
  </StrictMode>,
);
