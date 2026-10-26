/* eslint-disable react-refresh/only-export-components */
import { StrictMode, lazy } from "react";
import { createRoot } from "react-dom/client";

// Theme tokens and the Brand v2 fonts (theme.css imports brand/fonts.css; MUT-102)
import "./styles/theme.css";
import "./index.css";

// The one place outside the website's pages that may import its error reports (MUT-150, ADR-024)
// eslint-disable-next-line no-restricted-imports
import { LANDING_SENTRY_ENABLED, startLandingErrorReporting } from "./pages/landing/observability/landingErrorReporting";
import { LandingShell } from "./pages/landing/LandingShell";
import { landingRoute, marketingPath } from "./pages/landing/marketingPath";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import "./components/ui/ErrorBoundary.css";

const LandingPage = lazy(() => import("./pages/landing/LandingPage").then((m) => ({ default: m.LandingPage })));
const PrivacyPolicyPage = lazy(() => import("./pages/landing/PrivacyPolicyPage").then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsPage = lazy(() => import("./pages/landing/TermsPage").then((m) => ({ default: m.TermsPage })));

// The website's error reports (MUT-150, ADR-091), started before React renders
// so a crash at start-up is kept (eng O5).
startLandingErrorReporting({ enabled: LANDING_SENTRY_ENABLED });

/**
 * The website is the landing page, the privacy policy and the terms. The free
 * web app at /app and the desktop apps are retired (MUT-445): any other path,
 * /app included, goes to the home page (Netlify redirects it first in production).
 */
function App() {
  const path = marketingPath(window.location.pathname);
  // The one list of website pages (MUT-150 eng D7): error reports start and send only on these
  const route = landingRoute(window.location.pathname);

  if (route === "/") return <LandingShell><LandingPage /></LandingShell>;
  if (route === "/privacy") return <LandingShell><PrivacyPolicyPage search={window.location.search} /></LandingShell>;
  // MUT-324: /terms is the latest terms, /terms/<version> each released version, frozen;
  // ?lang is the language the portal records for the reader
  if (route === "/terms" || route === "/terms/:version") {
    return <LandingShell><TermsPage path={path} search={window.location.search} /></LandingShell>;
  }

  window.location.replace("/");
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
