import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';

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
