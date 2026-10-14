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
import { LanguageProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { LandingProviders } from "./pages/landing/LandingProviders";
import { HOSTED_OFFER_URL } from "./content/download-config";
import { ToastContainer } from "./components/ui/ToastContainer";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import "./components/ui/ErrorBoundary.css";
import { handleVersionChange } from "./lib/platform";
import { removeRetiredStorageKeys } from "./lib/retiredStorage";

// Handle version changes early (clears update caches when app updates)
// This ensures users who install a new DMG see the correct version
declare const __APP_VERSION__: string | undefined;
handleVersionChange(__APP_VERSION__ || "0.0.0");
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

const HostedOfferPage =
  __BUILD_MODE__ === "web"
    ? lazy(() =>
        import("./pages/landing/HostedOfferPage").then((m) => ({
          default: m.HostedOfferPage,
        })),
      )
    : null;

const queryClient = createAppQueryClient();

// Simple loading fallback for landing pages
const LandingLoader = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "var(--bg)",
      color: "var(--muted)",
    }}
  >
    Loading...
  </div>
);

function App() {
  // Web build: handle landing routes outside router
  if (__BUILD_MODE__ === "web") {
    const path = window.location.pathname;

    if (path === "/" && LandingPage) {
      return (
        <LandingProviders>
          <Suspense fallback={<LandingLoader />}>
            <LandingPage />
          </Suspense>
        </LandingProviders>
      );
    }

    if (path === "/download" && DownloadPage) {
      return (
        <LandingProviders>
          <Suspense fallback={<LandingLoader />}>
            <DownloadPage />
          </Suspense>
        </LandingProviders>
      );
    }

    if (path === "/privacy" && PrivacyPolicyPage) {
      return (
        <LandingProviders>
          <Suspense fallback={<LandingLoader />}>
            <PrivacyPolicyPage />
          </Suspense>
        </LandingProviders>
      );
    }

    if (path === HOSTED_OFFER_URL && HostedOfferPage) {
      return (
        <LandingProviders>
          <Suspense fallback={<LandingLoader />}>
            <HostedOfferPage />
          </Suspense>
        </LandingProviders>
      );
    }
  }

  // Main app with router
  return (
    <ThemeProvider>
      <LanguageProvider>
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
