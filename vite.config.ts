import { defineConfig, type HtmlTagDescriptor, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA, type ManifestOptions, type VitePWAOptions } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import pkg from "./package.json";
import ar from "./src/lib/i18n/translations/ar.json";

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

/** Where the landing page is served; override with MUTABA3A_PUBLIC_ORIGIN (e.g. a staging host). */
const DEFAULT_PUBLIC_ORIGIN = "https://mutaba3a.app";

/** The share card in `public/`: Claude Design's Arabic card, 1.91:1 so feeds show it large (MUT-104, D9). */
const SOCIAL_CARD = { path: "/og-card-ar-1200x630.png", width: 1200, height: 630 };

/**
 * Open Graph and Twitter tags for link previews (MUT-104). Crawlers run no
 * JavaScript, so the card has one language: Arabic, built from the landing
 * hero copy so the preview never drifts from the page (D4, D9). Throws on an
 * origin that isn't https, so a bad MUTABA3A_PUBLIC_ORIGIN fails the build
 * instead of shipping broken cards. Vite escapes the attribute values.
 */
export function socialMetaTags(origin: string): HtmlTagDescriptor[] {
  if (!/^https:\/\/[^/\s]+\/?$/.test(origin)) {
    throw new Error(`MUTABA3A_PUBLIC_ORIGIN must be an https origin, got ${JSON.stringify(origin)}`);
  }
  const base = origin.replace(/\/$/, "");
  const { headlineLine1, headlineLine2, subheadline } = ar.landing.hero;
  const title = `${headlineLine1} ${headlineLine2}`;
  const image = `${base}${SOCIAL_CARD.path}`;
  const og = {
    "og:type": "website",
    "og:site_name": PWA_MANIFEST.name,
    "og:url": `${base}/`,
    "og:title": title,
    "og:description": subheadline,
    "og:locale": "ar_AR",
    "og:locale:alternate": "en_US",
    "og:image": image,
    "og:image:width": String(SOCIAL_CARD.width),
    "og:image:height": String(SOCIAL_CARD.height),
    "og:image:alt": `${PWA_MANIFEST.name}: ${title}`,
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
 * The service worker's cache rules. Thmanyah (~1.2 MB of .otf, which the
 * licence forbids converting) is cached on use instead of being precached on
 * every install (MUT-102, PD10). No font is preloaded either: a preload
 * competed with the app code and delayed first paint by ~700 ms (ADR-058).
 */
export const PWA_WORKBOX: VitePWAOptions["workbox"] = {
  navigateFallback: "/index.html",
  // Only serve SPA shell for /app/* routes
  navigateFallbackAllowlist: [/^\/app/],
  navigateFallbackDenylist: [
    /^\/download(\/|$)/,  // /download/* never gets SPA
    /^\/api\//,           // future-proofing for API routes
  ],
  // Limit what files get precached
  globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
  // Share cards are for crawlers, never shown in the app (MUT-104)
  globIgnores: ["og-*.png"],
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
 * The hosted portal (MUT-43, hosted-portal.md §2, §7.5, §9): its own entry,
 * output and public dir, and no PWA plugin, so no service worker or offline
 * cache can ever hold firm figures. Same-origin with the API in dev through the
 * proxy, like the API service will serve it in production.
 */
function hostedConfig(): UserConfig {
  return {
    base: "/",
    publicDir: "src/hosted/public",
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_MODE__: JSON.stringify("hosted"),
    },
    plugins: [react(), emitHostedEntryAsIndex()],
    clearScreen: false,
    server: {
      port: HOSTED_DEV_PORT,
      strictPort: true,
      host: "127.0.0.1",
      proxy: {
        "/v1": { target: process.env.MUTABA3A_API_ORIGIN ?? DEFAULT_DEV_API_ORIGIN },
      },
    },
    build: {
      target: "esnext",
      outDir: "dist-hosted",
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

  return {
    base: isTauri ? "./" : "/",
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_MODE__: JSON.stringify(buildMode),
    },
  plugins: [
    react(),
    ...(buildMode === "web" ? [socialMeta()] : []),
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
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react/jsx-runtime"],
          "vendor-router": ["@tanstack/react-router"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-forms": ["react-hook-form", "zod"],
          "vendor-db": ["dexie"],
        },
      },
    },
  },
};
});
