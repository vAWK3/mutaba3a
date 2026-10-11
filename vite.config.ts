import { defineConfig, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import pkg from "./package.json";

/** Dev-only default for where `vite --mode hosted` proxies `/v1`; override with MUTABA3A_API_ORIGIN. */
const DEFAULT_DEV_API_ORIGIN = "http://127.0.0.1:8787";
const HOSTED_DEV_PORT = 5175;

/**
 * The server's SPA fallback serves `index.html` (hosted-portal.md §9), while the
 * source entry is `hosted.html` so it can sit beside the app's `index.html`.
 */
function emitHostedEntryAsIndex(): Plugin {
  return {
    name: "mutaba3a:hosted-index",
    enforce: "post",
    generateBundle(_options, bundle) {
      const entry = bundle["hosted.html"];
      if (entry?.type !== "asset") return;
      delete bundle["hosted.html"];
      this.emitFile({ type: "asset", fileName: "index.html", source: entry.source });
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
    VitePWA({
      disable: isTauri, // Disable PWA for desktop builds
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/maskable-512.png",
      ],
      manifest: {
        name: "متابعة",
        short_name: "متابعة",
        description:
          "Offline-first mini CRM and finance tracker for freelancers.",
        theme_color: "#070C16",
        background_color: "#070C16",
        display: "standalone",
        scope: isTauri ? "/" : "/app/",
        start_url: isTauri ? "/" : "/app/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Only serve SPA shell for /app/* routes
        navigateFallbackAllowlist: [/^\/app/],
        navigateFallbackDenylist: [
          /^\/download(\/|$)/,  // /download/* never gets SPA
          /^\/api\//,           // future-proofing for API routes
        ],
        // Limit what files get precached
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
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
