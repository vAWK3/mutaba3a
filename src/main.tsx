/* eslint-disable react-refresh/only-export-components */
import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

// Theme tokens and the Brand v2 fonts (theme.css imports brand/fonts.css; MUT-102)
import "./styles/theme.css";
import "./index.css";
import { createAppQueryClient } from "./lib/queryClient";

import { router } from "./router";
// The one storage call outside the seam (MUT-47): Dexie must open, and run
// its migrations, before React mounts and anything resolves getRepositories().
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { initDatabase } from "./db";
import { DEFAULT_LANGUAGE, LanguageProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { LandingProviders } from "./pages/landing/LandingProviders";
import { HOSTED_OFFER_URL } from "./content/download-config";
import { landingRoute, marketingPath } from "./pages/landing/marketingPath";
import { ToastContainer } from "./components/ui/ToastContainer";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { BootSplash } from "./components/brand/BootSplash";
import "./components/ui/ErrorBoundary.css";
import { handleVersionChange } from "./lib/platform";
import { APP_VERSION } from "./lib/appVersion";
import { seedSeenVersion } from "./lib/whatsNew/whatsNewState";
import { removeRetiredStorageKeys } from "./lib/retiredStorage";

// Handle version changes early (clears update caches when app updates)
// This ensures users who install a new DMG see the correct version.
// "What's new" starts from the version this browser last ran (MUT-24).
seedSeenVersion(handleVersionChange(APP_VERSION), APP_VERSION);
removeRetiredStorageKeys();

// Lazy load landing pages (only imported in web build, tree-shaken from desktop)
const LandingPage =
  __BUILD_MODE__ === "web"
    ? lazy(() =>
        import("./pages/landing/LandingPage").then((m) => ({
          default: m.LandingPage,
        })),
      )
    : null;

const DownloadPage =
  __BUILD_MODE__ === "web"
    ? lazy(() =>
        import("./pages/download/DownloadPage").then((m) => ({
          default: m.DownloadPage,
        })),
      )
    : null;

const PrivacyPolicyPage =
  __BUILD_MODE__ === "web"
    ? lazy(() =>
        import("./pages/landing/PrivacyPolicyPage").then((m) => ({
          default: m.PrivacyPolicyPage,
        })),
      )
    : null;

const TermsPage =
  __BUILD_MODE__ === "web"
    ? lazy(() =>
        import("./pages/landing/TermsPage").then((m) => ({
          default: m.TermsPage,
        })),
      )
    : null;

const queryClient = createAppQueryClient();

function App() {
  // Web build: handle landing routes outside router
  if (__BUILD_MODE__ === "web") {
    const path = marketingPath(window.location.pathname);
    // The one list of website pages (MUT-150 eng D7): error reports start and send only on these
    const route = landingRoute(window.location.pathname);

    if (route === "/" && LandingPage) {
      return (
        <LandingProviders>
          <Suspense fallback={<BootSplash />}>
            <LandingPage />
          </Suspense>
        </LandingProviders>
      );
    }

    if (route === "/download" && DownloadPage) {
      return (
        <LandingProviders>
          <Suspense fallback={<BootSplash />}>
            <DownloadPage />
          </Suspense>
        </LandingProviders>
      );
    }

    if (route === "/privacy" && PrivacyPolicyPage) {
      return (
        <LandingProviders>
          <Suspense fallback={<BootSplash />}>
            <PrivacyPolicyPage search={window.location.search} />
          </Suspense>
        </LandingProviders>
      );
    }

    // MUT-324: /terms is the latest terms, /terms/<version> each released version, frozen;
    // ?lang is the language the portal records for the reader
    if ((route === "/terms" || route === "/terms/:version") && TermsPage) {
      return (
        <LandingProviders>
          <Suspense fallback={<BootSplash />}>
            <TermsPage path={path} search={window.location.search} />
          </Suspense>
        </LandingProviders>
      );
    }

    // /hosted is retired (the free-vs-hosted comparison): hosted is now the only
    // plan, and its request form lives inline on the main landing page instead.
    if (path === HOSTED_OFFER_URL) {
      window.location.replace("/");
      return null;
    }
  }

  // Main app with router
  return (
    <ThemeProvider>
      {/* Arabic until a person chooses; a language stored by detection doesn't count (MUT-209, ADR-077) */}
      <LanguageProvider defaultLanguage={DEFAULT_LANGUAGE}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <ToastContainer />
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

// Initialize database with default settings (no sample data)
initDatabase().catch(console.error);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
