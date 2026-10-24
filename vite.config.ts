import { defineConfig, type HtmlTagDescriptor, type Plugin, type PluginOption, type UserConfig } from "vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { SENTRY_INGEST_ORIGIN } from "./server/src/observability/sentry-ingest";
import react from "@vitejs/plugin-react";
import { VitePWA, type ManifestOptions, type VitePWAOptions } from "vite-plugin-pwa";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pkg from "./package.json";
import { HOSTS, type ResolvedHosts } from "./config/hosts";
import ar from "./src/lib/i18n/translations/ar";
import {
  HONEYPOT_FIELD,
  HOSTED_REQUEST_FIELDS,
  HOSTED_REQUEST_FORM_NAME,
  MULTILINE_FIELDS,
  NETLIFY_FORMS_FILE,
} from "./src/pages/landing/hostedRequest";
import { HOSTED_OFFER_URL } from "./src/content/download-config";
import { TERMS_MANIFEST_FILE, termsManifest } from "./src/content/legal/termsManifest";

/** Dev-only default for where `vite --mode hosted` proxies `/v1`; override with MUTABA3A_API_ORIGIN. */
const DEFAULT_DEV_API_ORIGIN = "http://127.0.0.1:8787";
const HOSTED_DEV_PORT = 5175;

/**
 * The server's SPA fallback serves `index.html` (hosted-portal.md §9), while the
 * source entry is `hosted.html` so it can sit beside the app's `index.html`. In
 * dev, every page request gets `hosted.html` too, so `vite --mode hosted` never
 * serves the local app (and its IndexedDB) from the portal's origin.
 */
function emitHostedEntryAsIndex(): Plugin {
  return {
    name: "mutaba3a:hosted-index",
    enforce: "post",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const isPage = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
        if (isPage && !req.url?.startsWith("/v1/")) req.url = "/hosted.html";
        next();
      });
    },
    generateBundle(_options, bundle) {
      const entry = bundle["hosted.html"];
      if (entry?.type !== "asset") return;
      delete bundle["hosted.html"];
      this.emitFile({ type: "asset", fileName: "index.html", source: entry.source });
    },
  };
}

/**
 * Where the landing page is served; override with MUTABA3A_PUBLIC_ORIGIN (e.g. a
 * staging host). From config/hosts.json (MUT-326): the Netlify origin until a
 * domain is set there, then its apex. It feeds the link-preview tags, the /hosted
 * canonical and the portal's sign-in link (MUT-188), all of which must point at a
 * host that answers.
 */
export const DEFAULT_PUBLIC_ORIGIN = HOSTS.landingOrigin;

/**
 * Where the free web app's "Already have an account? Sign in" link goes: the
 * service that serves the portal, from config/hosts.json (MUT-326). Override with
 * MUTABA3A_PORTAL_URL (MUT-187).
 */
export const DEFAULT_PORTAL_URL = HOSTS.portalOrigin;

/** `value` without its trailing slash; throws, naming `envVar`, unless it is a bare https origin. */
function assertHttpsOrigin(envVar: string, value: string): string {
  if (!/^https:\/\/[^/\s]+\/?$/.test(value)) {
    throw new Error(`${envVar} must be an https origin, got ${JSON.stringify(value)}`);
  }
  return value.replace(/\/$/, "");
}

/**
 * The version the build reports (Settings › About, What's new). package.json's,
 * unless MUTABA3A_APP_VERSION names another x.y.z: QA builds use it to run as
 * the version release-notes.json describes before the release bump (MUT-24).
 */
export function appVersion(override: string | undefined): string {
  if (override === undefined) return pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(override)) {
    throw new Error(`MUTABA3A_APP_VERSION must be x.y.z, got ${JSON.stringify(override)}`);
  }
  return override;
}

/**
 * The PostHog project ingest key (ADR-090, MUT-154/155): "" when
 * MUTABA3A_POSTHOG_KEY is unset, which keeps every analytics call a no-op. Only
 * a `phc_` project key is accepted, so a personal API key (`phx_`) can never be
 * baked into a public bundle. Set it for production builds only.
 */
export function posthogKey(override: string | undefined): string {
  if (override === undefined || override === "") return "";
  if (!/^phc_[A-Za-z0-9]{20,}$/.test(override)) {
    throw new Error("MUTABA3A_POSTHOG_KEY must be a PostHog project key (phc_ followed by at least 20 letters or digits)");
  }
  return override;
}

/** Cloudflare's published always-pass Turnstile site key: the default outside production (MUT-368, MUT-197 D4). */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

/**
 * The portal's Turnstile site key for /signup and /recover (MUT-368, D6). Unset, it is Cloudflare's always-pass test
 * key, so dev, tests, QA and test:bundles need nothing; deploy.sh refuses a test key once the server mails links.
 * Site keys are 24 characters (`0x` + 22); secrets are longer, so a secret pasted here fails the build, never ships.
 */
export function turnstileSiteKey(override: string | undefined): string {
  if (override === undefined || override === "") return TURNSTILE_TEST_SITE_KEY;
  if (!/^[0-3]x[0-9A-Za-z_-]{22}$/.test(override)) {
    throw new Error("MUTABA3A_TURNSTILE_SITE_KEY must be a Turnstile site key (0x followed by 22 letters, digits, - or _), never the secret");
  }
  return override;
}

/** The Sentry org and projects the browser surfaces report to, and where their source maps go (MUT-149/150, ADR-091). */
const SENTRY_ORG = "barmajiyat-ltd";
const SENTRY_PORTAL_PROJECT = "mutaba3a-web";
const SENTRY_LANDING_PROJECT = "mutaba3a-landing";
const SENTRY_EU_API = "https://de.sentry.io";
const SENTRY_HOSTED_MAPS = "dist-hosted/**/*.map";
const SENTRY_WEB_MAPS = "dist-web/**/*.map";

/**
 * A surface's Sentry DSN (MUT-149 D3): "" when unset, which compiles crash
 * reporting out of that build. Only a DSN on the org's EU ingest host is
 * accepted, the one origin PORTAL_CSP and check-bundles allow, so the build
 * fails rather than ship reports that would be blocked or leave the EU.
 */
export function sentryDsn(override: string | undefined, name = "MUTABA3A_SENTRY_DSN"): string {
  if (override === undefined || override === "") return "";
  const host = new URL(SENTRY_INGEST_ORIGIN).host.replace(/\./g, "\\.");
  if (!new RegExp(`^https://[0-9a-f]{32}@${host}/\\d+$`).test(override)) {
    throw new Error(`${name} must be a DSN on ${SENTRY_INGEST_ORIGIN} (the org's EU ingest host)`);
  }
  return override;
}

/** `mutaba3a-portal@<server version>+<sha>` from deploy.sh; the app version otherwise. */
export function sentryRelease(override: string | undefined): string {
  if (override === undefined || override === "") return `mutaba3a-portal@${pkg.version}`;
  if (!/^mutaba3a-portal@\S+$/.test(override)) throw new Error("MUTABA3A_SENTRY_RELEASE must be mutaba3a-portal@<version>");
  return override;
}

/** `mutaba3a-landing@<app version>+<short sha>` from Netlify's COMMIT_REF (MUT-150); the app version otherwise. */
export function landingSentryRelease(commitRef: string | undefined): string {
  if (commitRef === undefined || commitRef === "") return `mutaba3a-landing@${pkg.version}`;
  if (!/^[0-9a-f]{7,40}$/.test(commitRef)) throw new Error("COMMIT_REF must be a git commit sha");
  return `mutaba3a-landing@${pkg.version}+${commitRef.slice(0, 7)}`;
}

/** The environment events are filed under (deploy.sh ENVIRONMENT, Netlify CONTEXT); development otherwise. */
export function sentryEnvironment(override: string | undefined, name = "MUTABA3A_SENTRY_ENVIRONMENT"): string {
  if (override === undefined || override === "") return "development";
  if (!/^[a-z0-9-]{1,64}$/.test(override)) throw new Error(`${name} must be lowercase letters, digits or dashes`);
  return override;
}

interface SentryBuildTarget {
  project: string;
  dsn: string;
  release: string;
  mapsGlob: string;
  authToken: string | undefined;
}

/**
 * One browser surface's source maps (MUT-149 D6, MUT-150 eng D4): when a DSN
 * and an upload token are both set, hidden maps are uploaded to the surface's
 * project and then deleted, so no map is ever served. The token is read here
 * only, never defined into the bundle.
 */
function sentrySourceMaps(target: SentryBuildTarget): { sourcemap: "hidden" | false; plugins: PluginOption[] } {
  if (!target.dsn || !target.authToken) return { sourcemap: false, plugins: [] };
  return {
    sourcemap: "hidden",
    plugins: [
      sentryVitePlugin({
        org: SENTRY_ORG,
        project: target.project,
        url: SENTRY_EU_API,
        authToken: target.authToken,
        telemetry: false,
        release: { name: target.release, inject: false },
        sourcemaps: { filesToDeleteAfterUpload: [target.mapsGlob] },
        // A failed upload (revoked token, wrong scope) fails the build: the plugin only logs it otherwise
        errorHandler: (error) => {
          throw error;
        },
      }),
    ],
  };
}

/** The hosted build's crash reporting (MUT-149 D3, D6): the defines and the source maps. */
function hostedSentry(env: NodeJS.ProcessEnv): { define: Record<string, string>; sourcemap: "hidden" | false; plugins: PluginOption[] } {
  const dsn = sentryDsn(env.MUTABA3A_SENTRY_DSN);
  const release = sentryRelease(env.MUTABA3A_SENTRY_RELEASE);
  const define = {
    __SENTRY_ENABLED__: JSON.stringify(dsn !== ""),
    __SENTRY_DSN__: JSON.stringify(dsn),
    __SENTRY_RELEASE__: JSON.stringify(release),
    __SENTRY_ENVIRONMENT__: JSON.stringify(sentryEnvironment(env.MUTABA3A_SENTRY_ENVIRONMENT)),
  };
  const maps = sentrySourceMaps({ project: SENTRY_PORTAL_PROJECT, dsn, release, mapsGlob: SENTRY_HOSTED_MAPS, authToken: env.SENTRY_AUTH_TOKEN });
  return { define, ...maps };
}

/**
 * The landing's error reports (MUT-150, ADR-091): the web build only, and only
 * with MUTABA3A_LANDING_SENTRY_DSN, in Netlify's production context (any other
 * Netlify context compiles it out). The desktop build always gets the "off" defines, so the gate folds away and no
 * SDK chunk is emitted. A Netlify production build with a DSN but no upload
 * token fails: readable stacks are part of the feature, not optional.
 */
function landingSentry(env: NodeJS.ProcessEnv, buildMode: "web" | "desktop"): { define: Record<string, string>; sourcemap: "hidden" | false; plugins: PluginOption[] } {
  // On Netlify only the production context reports (review D4): a DSN set for every context by mistake
  // must not send deploy previews' errors to the production project or spend the shared quota
  const reportingContext = env.CONTEXT === undefined || env.CONTEXT === "" || env.CONTEXT === "production";
  const dsn = buildMode === "web" && reportingContext ? sentryDsn(env.MUTABA3A_LANDING_SENTRY_DSN, "MUTABA3A_LANDING_SENTRY_DSN") : "";
  // Release and environment are read only by the SDK chunk, which a build without a DSN never emits
  const release = dsn ? landingSentryRelease(env.COMMIT_REF) : "";
  const define = {
    __LANDING_SENTRY_ENABLED__: JSON.stringify(dsn !== ""),
    __LANDING_SENTRY_DSN__: JSON.stringify(dsn),
    __LANDING_SENTRY_RELEASE__: JSON.stringify(release),
    __LANDING_SENTRY_ENVIRONMENT__: JSON.stringify(dsn ? sentryEnvironment(env.CONTEXT, "CONTEXT") : ""),
  };
  if (dsn && env.CONTEXT === "production" && !env.SENTRY_AUTH_TOKEN) {
    throw new Error("SENTRY_AUTH_TOKEN must be set in Netlify's production context when MUTABA3A_LANDING_SENTRY_DSN is (source maps)");
  }
  const maps = sentrySourceMaps({ project: SENTRY_LANDING_PROJECT, dsn, release, mapsGlob: SENTRY_WEB_MAPS, authToken: env.SENTRY_AUTH_TOKEN });
  return { define, ...maps };
}

/** The portal origin the web build links to; a bad MUTABA3A_PORTAL_URL fails the build (MUT-187). */
export function portalUrl(override: string | undefined): string {
  return assertHttpsOrigin("MUTABA3A_PORTAL_URL", override ?? DEFAULT_PORTAL_URL);
}

/** MUT-324: the landing's /terms, which the portal links to (versioned as /terms/<version>); a bad origin fails the build. */
export function termsUrl(override: string | undefined): string {
  return `${assertHttpsOrigin("MUTABA3A_PUBLIC_ORIGIN", override ?? DEFAULT_PUBLIC_ORIGIN)}/terms`;
}

/** The public /hosted page the portal's sign-in links to; a bad MUTABA3A_PUBLIC_ORIGIN fails the build (MUT-188). */
export function hostedOfferUrl(override: string | undefined): string {
  return `${assertHttpsOrigin("MUTABA3A_PUBLIC_ORIGIN", override ?? DEFAULT_PUBLIC_ORIGIN)}${HOSTED_OFFER_URL}`;
}

/** A page with its own link preview: where it lives and what its card says. */
export interface SocialPage {
  path: string;
  title: string;
  description: string;
}

/** The landing page's card (MUT-104): the Arabic hero. */
const HOME_PAGE: SocialPage = {
  path: "/",
  title: `${ar.landing.hero.headlineLine1} ${ar.landing.hero.headlineLine2}`,
  description: ar.landing.hero.subheadline,
};

/** The share card in `public/`: Claude Design's Arabic card, 1.91:1 so feeds show it large (MUT-104, D9). */
const SOCIAL_CARD = { path: "/og-card-ar-1200x630.png", width: 1200, height: 630 };

/**
 * Open Graph and Twitter tags for link previews (MUT-104). Crawlers run no
 * JavaScript, so the card has one language: Arabic, built from the landing
 * hero copy so the preview never drifts from the page (D4, D9). Throws on an
 * origin that isn't https, so a bad MUTABA3A_PUBLIC_ORIGIN fails the build
 * instead of shipping broken cards. Vite escapes the attribute values.
 */
export function socialMetaTags(origin: string, page: SocialPage = HOME_PAGE): HtmlTagDescriptor[] {
  const base = assertHttpsOrigin("MUTABA3A_PUBLIC_ORIGIN", origin);
  const { title, description: subheadline } = page;
  const image = `${base}${SOCIAL_CARD.path}`;
  const og = {
    "og:type": "website",
    "og:site_name": PWA_MANIFEST.name,
    "og:url": `${base}${page.path}`,
    "og:title": title,
    "og:description": subheadline,
    "og:locale": "ar_AR",
    "og:locale:alternate": "en_US",
    "og:image": image,
    "og:image:width": String(SOCIAL_CARD.width),
    "og:image:height": String(SOCIAL_CARD.height),
    // The one card image shows the home headline, so its description does too, on every page
    "og:image:alt": `${PWA_MANIFEST.name}: ${HOME_PAGE.title}`,
  };
  const twitter = {
    "twitter:card": "summary_large_image",
    "twitter:title": title,
    "twitter:description": subheadline,
    "twitter:image": image,
  };
  return [
    ...Object.entries(og).map(([property, content]) => ({ tag: "meta", attrs: { property, content }, injectTo: "head" as const })),
    ...Object.entries(twitter).map(([name, content]) => ({ tag: "meta", attrs: { name, content }, injectTo: "head" as const })),
  ];
}

/** Adds the link-preview tags to the landing page's HTML. Web build only: desktop has no public URL. */
function socialMeta(): Plugin {
  const tags = socialMetaTags(process.env.MUTABA3A_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN);
  return { name: "mutaba3a:social-meta", transformIndexHtml: () => tags };
}

/**
 * The hidden static twin of /hosted's request form (MUT-186). Netlify registers
 * forms it finds in deployed HTML, and the real form is rendered by React, so
 * the twin names every field the page posts. Its own file, not index.html or
 * public/, because both are shared with the desktop build; noindex because it
 * is a bare form, not a page (D2).
 */
export function netlifyFormsHtml(): string {
  const fields = HOSTED_REQUEST_FIELDS.map((name) =>
    MULTILINE_FIELDS.has(name) ? `<textarea name="${name}"></textarea>` : `<input name="${name}">`,
  ).join("");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">` +
    `<title>${HOSTED_REQUEST_FORM_NAME}</title></head><body>` +
    `<form name="${HOSTED_REQUEST_FORM_NAME}" data-netlify="true" netlify-honeypot="${HONEYPOT_FIELD}" hidden>${fields}</form>` +
    `</body></html>`
  );
}

/**
 * Dev only: Vite's HTML fallback serves `/hosted` from the portal's entry,
 * `hosted.html`, which sits beside `index.html`. Route the offer page to the
 * app shell instead, as Netlify's SPA fallback does in production, where the
 * web build has no hosted.html (MUT-186).
 */
function hostedOfferDevRoute(): Plugin {
  const pattern = new RegExp(`^${HOSTED_OFFER_URL}(?=$|\\?)`);
  return {
    name: "mutaba3a:hosted-offer-dev-route",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && pattern.test(req.url)) req.url = req.url.replace(pattern, "/index.html");
        next();
      });
    },
  };
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * `html` with its Open Graph / Twitter tags and its <title> replaced by
 * `tags` and `documentTitle`; everything else (the app's scripts) untouched.
 */
export function withPageMeta(html: string, tags: HtmlTagDescriptor[], documentTitle: string, canonicalUrl: string): string {
  const serialized = tags
    .map(({ attrs }) => {
      const pairs = Object.entries(attrs ?? {}).map(([key, value]) => `${key}="${escapeHtml(String(value))}"`);
      return `<meta ${pairs.join(" ")}>`;
    })
    .join("\n    ");
  const canonical = `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`;
  // Function replacers: a $ in the copy must be written literally, not read as a pattern
  return html
    .replace(/<meta\s+(?:property|name)="(?:og|twitter):[^"]*"\s+content="[^"]*"\s*\/?>\s*/g, "")
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(documentTitle)}</title>`)
    .replace("</head>", () => `    ${serialized}\n    ${canonical}\n  </head>`);
}

/**
 * MUT-324 (D11): `/legal/terms-versions.json`, every released terms version and the sha256 of its EN and AR
 * text, which the server release preflight checks before a server naming a new version is released. Web only.
 */
function legalTermsManifest(): Plugin {
  const dir = fileURLToPath(new URL("./src/content/legal/terms/", import.meta.url));
  return {
    name: "mutaba3a:legal-terms-manifest",
    generateBundle() {
      // Files only: a folder in there (drafts/) is not a released text
      const files = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map(({ name }) => ({ name, bytes: readFileSync(`${dir}${name}`) }));
      this.emitFile({ type: "asset", fileName: TERMS_MANIFEST_FILE, source: `${JSON.stringify(termsManifest(files), null, 2)}\n` });
    },
  };
}

/** Emits the form twin at the path the page posts to. Web build only: Netlify serves only the web build. */
function netlifyForms(): Plugin {
  return {
    name: "mutaba3a:netlify-forms",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: NETLIFY_FORMS_FILE, source: netlifyFormsHtml() });
    },
  };
}

/**
 * The landing pages a visitor on the old Netlify host is sent on to the apex at stage
 * "redirect" (config/hosts.json; MUT-326, ADR-155 D5). Never `/app/*`, its assets or
 * the service worker: the free web app's records live in that origin's IndexedDB
 * until MUT-291's bridge carries them over.
 */
export const LEGACY_LANDING_PATHS = ["/", "/download", "/privacy", "/terms", "/terms/*"] as const;

/** One Netlify `_redirects` line; `/*` paths carry the rest of the path over. 302 so a rollback is never stuck in a cache. */
function redirectLine(fromOrigin: string, path: string, toOrigin: string): string {
  const to = path.endsWith("/*") ? `${path.slice(0, -1)}:splat` : path;
  return `${fromOrigin}${path} ${toOrigin}${to} 302!`;
}

/**
 * Netlify `_redirects` for the domain move, or "" while there is nothing to redirect.
 * Host-scoped, so deploy previews are untouched.
 * - From stage "live": the apex's `/app` goes back to the old host, where the free web
 *   app's data is (the landing links to `/app` relatively); MUT-291 retires this.
 * - At stage "redirect": the old host's landing pages go on to the apex.
 */
export function netlifyRedirects(hosts: Pick<ResolvedHosts, "stage" | "legacy" | "frontDoor">): string {
  if (!hosts.legacy || !hosts.frontDoor || (hosts.stage !== "live" && hosts.stage !== "redirect")) return "";
  const apex = `https://${hosts.frontDoor.landingHost}`;
  const old = hosts.legacy.landingOrigin;
  const lines = [
    redirectLine(apex, "/app", old),
    redirectLine(apex, "/app/*", old),
    ...(hosts.stage === "redirect" ? LEGACY_LANDING_PATHS.map((path) => redirectLine(old, path, apex)) : []),
  ];
  return `${lines.join("\n")}\n`;
}

/** Emits `_redirects` (read before netlify.toml's rules) only when there is something to redirect. */
function domainMoveRedirects(): Plugin {
  const source = netlifyRedirects(HOSTS);
  return {
    name: "mutaba3a:domain-move-redirects",
    generateBundle() {
      if (source) this.emitFile({ type: "asset", fileName: "_redirects", source });
    },
  };
}

/**
 * The service worker's cache rules. Thmanyah (~1.2 MB of .otf, which the
 * licence forbids converting) is cached on use instead of being precached on
 * every install (MUT-102, PD10). No font is preloaded either: a preload
 * competed with the app code and delayed first paint by ~700 ms (ADR-058).
 */
/** The web build's chunk for posthog-js (MUT-154): named, so the service worker can leave it out. */
export const POSTHOG_CHUNK = "vendor-posthog";

/**
 * The landing's counting code is never precached (MUT-154 review F1): the
 * service worker installs for everyone who opens the local app, which must
 * never store PostHog. `posthogConfig-*` is the lazy chunk holding the
 * contract guard. check-bundles fails if any precached file mentions PostHog.
 */
export const POSTHOG_PRECACHE_IGNORES = [`assets/${POSTHOG_CHUNK}-*.js`, "assets/posthogConfig-*.js"];

/** The web build's chunk for @sentry/browser (MUT-150): named only when the landing DSN is set. */
export const SENTRY_CHUNK = "vendor-sentry";

/**
 * The landing's error-report chunks are never precached (MUT-150, as MUT-154
 * F1 for PostHog): the service worker installs for everyone who opens the
 * local app, which must never store the Sentry SDK (ADR-024). check-bundles
 * fails if any precached file carries it.
 */
export const SENTRY_PRECACHE_IGNORES = [`assets/${SENTRY_CHUNK}-*.js`, "assets/landingSentry-*.js"];

export const PWA_WORKBOX: VitePWAOptions["workbox"] = {
  navigateFallback: "/index.html",
  // Only serve SPA shell for /app/* routes
  navigateFallbackAllowlist: [/^\/app/],
  navigateFallbackDenylist: [
    /^\/download(\/|$)/,  // /download/* never gets SPA
    /^\/api\//,           // future-proofing for API routes
  ],
  // The service worker carries no source map: vite-plugin-pwa would emit sw.js.map whenever the
  // landing's maps are "hidden" for the Sentry upload, and no map may ship (MUT-150 review)
  sourcemap: false,
  // Limit what files get precached
  globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
  // Share cards are for crawlers, never shown in the app (MUT-104)
  // The Netlify form twin is a bare form for the deploy bot, never opened in the app (MUT-186, D2)
  // The landing's PostHog chunks are fetched only on the landing, never stored for the local app (MUT-154)
  globIgnores: ["og-*.png", NETLIFY_FORMS_FILE, ...POSTHOG_PRECACHE_IGNORES, ...SENTRY_PRECACHE_IGNORES],
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.destination === "font",
      handler: "CacheFirst",
      options: { cacheName: "fonts", expiration: { maxEntries: 12 } },
    },
  ],
};

/** Files in `public/` the service worker precaches beside the build, so the tab and home-screen icons work offline (MUT-104). */
export const PWA_INCLUDE_ASSETS = [
  "favicon.svg",
  "favicon-32.png",
  "favicon-16.png",
  "apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
];

/**
 * The web app manifest. Splash and title bar use the Brand v2 light canvas,
 * `color.canvas` in `mutaba3a.tokens.json` (MUT-104); the scope is set per
 * build in the config below.
 */
export const PWA_MANIFEST = {
  name: "متابعة",
  short_name: "متابعة",
  description: "Offline-first mini CRM and finance tracker for freelancers.",
  theme_color: "#FCF6ED",
  background_color: "#FCF6ED",
  display: "standalone",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
} satisfies Partial<ManifestOptions>;

/**
 * The server's route modules call `Buffer.from(…)` as a Node global (MUT-286).
 * In the portal's local chunk that name is bound, per module, to the slice of
 * Buffer they use (`src/hosted/local/platform/buffer-shim.ts`), never set on
 * `globalThis` (MUT-287): a global partial Buffer makes any library that
 * sniffs `typeof Buffer` take its Node path (jszip's did, and its records zip
 * broke in the browser). Runs after TypeScript is stripped, so only value
 * references to `Buffer` remain to be bound. The import goes at the end:
 * imports hoist, so every existing line and column stays where it was and the
 * module's source map needs no change (`map: null`).
 */
export function scopeServerBufferShim(): Plugin {
  const shim = fileURLToPath(new URL("./src/hosted/local/platform/buffer-shim.ts", import.meta.url));
  return {
    name: "mut-scope-server-buffer-shim",
    enforce: "post",
    transform(code, id) {
      if (!id.includes("/server/src/") || id.includes("/node_modules/") || !/\bBuffer\b/.test(code)) return null;
      return { code: `${code}\nimport { bufferShim as Buffer } from ${JSON.stringify(shim)};\n`, map: null };
    },
  };
}

/**
 * The hosted portal (MUT-43, hosted-portal.md §2, §7.5, §9): its own entry,
 * output and public dir, and no PWA plugin, so no service worker or offline
 * cache can ever hold firm figures. Same-origin with the API in dev through the
 * proxy, like the API service will serve it in production.
 */
function hostedConfig(): UserConfig {
  const sentry = hostedSentry(process.env);
  return {
    base: "/",
    publicDir: "src/hosted/public",
    resolve: {
      // Local mode (MUT-286) runs the server's own route modules in the page:
      // they touch exactly two Node built-ins (`node:crypto`'s synchronous
      // surface and `node:async_hooks`'s `AsyncLocalStorage`, the latter only
      // because `hono/context-storage` imports it). Aliased here, not in the
      // app's own `vite.config.ts` branch below, so the web/desktop builds and
      // the server's own `tsc` build never see this redirection.
      alias: {
        "node:crypto": fileURLToPath(
          new URL("./src/hosted/local/platform/crypto.ts", import.meta.url),
        ),
        "node:async_hooks": fileURLToPath(
          new URL("./src/hosted/local/platform/async-hooks.ts", import.meta.url),
        ),
        // Imported by the server's app.ts for password hashing, which only ever runs on the server: a stub that throws,
        // so the build never needs the package's optional WASM browser entry (src/hosted/local/platform/argon2.ts).
        "@node-rs/argon2": fileURLToPath(
          new URL("./src/hosted/local/platform/argon2.ts", import.meta.url),
        ),
        // The portal reaches the lazy local chunk only through this alias
        // (src/hosted/session/localBackendContract.ts).
        "@mut/local-backend": fileURLToPath(
          new URL("./src/hosted/local/index.ts", import.meta.url),
        ),
        // MUT-325: the signed-in Download, a chunk of its own loaded on click
        // (src/hosted/session/recordsExportContract.ts).
        "@mut/records-export": fileURLToPath(
          new URL("./src/hosted/local/hostedExport.ts", import.meta.url),
        ),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion(process.env.MUTABA3A_APP_VERSION)),
      __BUILD_MODE__: JSON.stringify("hosted"),
      // The sign-in page's "No account? Request one" link (MUT-188): the landing's /hosted page
      __HOSTED_OFFER_URL__: JSON.stringify(hostedOfferUrl(process.env.MUTABA3A_PUBLIC_ORIGIN)),
      // The terms the setup page, the Updated-terms step and the account menu link to (MUT-324)
      __TERMS_URL__: JSON.stringify(termsUrl(process.env.MUTABA3A_PUBLIC_ORIGIN)),
      // Opt-in, anonymous usage counts (MUT-155, ADR-090); "" turns analytics off
      __POSTHOG_KEY__: JSON.stringify(posthogKey(process.env.MUTABA3A_POSTHOG_KEY)),
      // The bot check on /signup and /recover (MUT-368); public, never the secret
      __TURNSTILE_SITE_KEY__: JSON.stringify(turnstileSiteKey(process.env.MUTABA3A_TURNSTILE_SITE_KEY)),
      // Crash reports, signed in only (MUT-149, ADR-091 am.11); no DSN compiles them out
      ...sentry.define,
    },
    plugins: [react(), emitHostedEntryAsIndex(), scopeServerBufferShim(), ...sentry.plugins],
    clearScreen: false,
    server: {
      port: HOSTED_DEV_PORT,
      strictPort: true,
      host: "127.0.0.1",
      // Release-QA run in place writes traces into qa/runs/ (MUT-325): watching them reloaded pages mid-test.
      watch: { ignored: ["**/qa/runs/**"] },
      proxy: {
        "/v1": { target: process.env.MUTABA3A_API_ORIGIN ?? DEFAULT_DEV_API_ORIGIN },
        // MUT-396: a local API (ATTACHMENTS_DRIVER=local) signs upload/download URLs on the request's origin; this
        // keeps them same-origin for the portal, which PORTAL_CSP's connect-src 'self' requires.
        "/dev/attachments": { target: process.env.MUTABA3A_API_ORIGIN ?? DEFAULT_DEV_API_ORIGIN },
      },
    },
    build: {
      target: "esnext",
      outDir: "dist-hosted",
      // Maps only for the upload, and no sourceMappingURL comment (MUT-149 AC4)
      sourcemap: sentry.sourcemap,
      rollupOptions: {
        input: fileURLToPath(new URL("./hosted.html", import.meta.url)),
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react/jsx-runtime"],
            "vendor-router": ["@tanstack/react-router"],
            "vendor-query": ["@tanstack/react-query"],
          },
        },
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === "hosted") return hostedConfig();

  // Check both Tauri env vars AND the --mode flag
  const isTauri = !!process.env.TAURI_PLATFORM || !!process.env.TAURI_FAMILY || mode === "desktop";
  const buildMode = isTauri ? "desktop" : "web";
  const sentry = landingSentry(process.env, buildMode);

  return {
    base: isTauri ? "./" : "/",
    define: {
      __APP_VERSION__: JSON.stringify(appVersion(process.env.MUTABA3A_APP_VERSION)),
      __BUILD_MODE__: JSON.stringify(buildMode),
      // The free web app's portal sign-in link (MUT-187); desktop carries no portal address
      __PORTAL_URL__: JSON.stringify(buildMode === "web" ? portalUrl(process.env.MUTABA3A_PORTAL_URL) : ""),
      // The landing's cookieless visit counts (MUT-154, ADR-090); the local app and desktop never use it
      __POSTHOG_KEY__: JSON.stringify(buildMode === "web" ? posthogKey(process.env.MUTABA3A_POSTHOG_KEY) : ""),
      // The landing's error reports (MUT-150); desktop always gets the "off" values
      ...sentry.define,
    },
  plugins: [
    react(),
    ...(buildMode === "web" ? [socialMeta(), netlifyForms(), legalTermsManifest(), domainMoveRedirects(), hostedOfferDevRoute()] : []),
    ...sentry.plugins,
    VitePWA({
      disable: isTauri, // Disable PWA for desktop builds
      registerType: "autoUpdate",
      includeAssets: PWA_INCLUDE_ASSETS,
      manifest: {
        ...PWA_MANIFEST,
        scope: isTauri ? "/" : "/app/",
        start_url: isTauri ? "/" : "/app/",
      },
      workbox: PWA_WORKBOX,
      devOptions: {
        enabled: false,  // Disable PWA in dev to avoid caching issues
      },
    }),
  ],
  // Dev server only (MUT-150): pre-bundle the landing's SDK up front, or its first lazy load reloads the page
  ...(sentry.define.__LANDING_SENTRY_ENABLED__ === "true" ? { optimizeDeps: { include: ["@sentry/browser"] } } : {}),
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      // Redirect /download/* to GitHub in dev (mirrors Netlify behavior)
      '/download/mac': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: () => '/vAWK3/mutaba3a/releases/latest/download/mutaba3a-macos-arm64.dmg',
      },
      '/download/windows': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: () => '/vAWK3/mutaba3a/releases/latest/download/mutaba3a-windows-x64.msi',
      },
      '/download/windows-exe': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: () => '/vAWK3/mutaba3a/releases/latest/download/mutaba3a-windows-x64-setup.exe',
      },
      '/download/release-notes': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: () => '/vAWK3/mutaba3a/releases/latest',
      },
    },
  },
  build: {
    target: "esnext",
    outDir: isTauri ? "dist-desktop" : "dist-web",
    // Maps only for the upload, and no sourceMappingURL comment (MUT-150 AC5); off without a DSN and token
    ...(sentry.sourcemap ? { sourcemap: sentry.sourcemap } : {}),
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react/jsx-runtime"],
          "vendor-router": ["@tanstack/react-router"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-forms": ["react-hook-form", "zod"],
          "vendor-db": ["dexie"],
          // Desktop never imports posthog-js; naming it there would emit the chunk anyway
          ...(isTauri ? {} : { [POSTHOG_CHUNK]: ["posthog-js"] }),
          // Named only when the landing reports: naming it would emit the chunk even unimported (eng O2)
          ...(sentry.define.__LANDING_SENTRY_ENABLED__ === "true" ? { [SENTRY_CHUNK]: ["@sentry/browser"] } : {}),
        },
      },
    },
  },
};
});
