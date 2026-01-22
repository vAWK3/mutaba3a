import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

const isTauri = !!process.env.TAURI_PLATFORM || !!process.env.TAURI_FAMILY;
const buildMode = isTauri ? "desktop" : "web";

export default defineConfig({
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
        rewrite: () => '/vAWK3/mutaba3a/releases/latest/download/mutaba3a-macos-universal.dmg',
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
});
