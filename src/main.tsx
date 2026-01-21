import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

// Import fonts
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";

// Import theme and styles
import "./styles/theme.css";
import "./index.css";

import { router } from "./router";
import { initDatabase } from "./db";
import { LanguageProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { ToastContainer } from "./components/ui/ToastContainer";

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

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

// Simple loading fallback for landing pages
const LandingLoader = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "var(--color-bg-base, #070C16)",
      color: "var(--color-text-muted, #888)",
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
        <ThemeProvider>
          <LanguageProvider>
            <Suspense fallback={<LandingLoader />}>
              <LandingPage />
            </Suspense>
          </LanguageProvider>
        </ThemeProvider>
      );
    }

    if (path === "/download" && DownloadPage) {
      return (
        <ThemeProvider>
          <LanguageProvider>
            <Suspense fallback={<LandingLoader />}>
              <DownloadPage />
            </Suspense>
          </LanguageProvider>
        </ThemeProvider>
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
    <App />
  </StrictMode>,
);
