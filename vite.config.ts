import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

const isTauri = !!process.env.TAURI_PLATFORM || !!process.env.TAURI_FAMILY
const buildMode = isTauri ? 'desktop' : 'web'

export default defineConfig({
  base: isTauri ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_MODE__: JSON.stringify(buildMode),
  },
  plugins: [
    react(),
    VitePWA({
      disable: isTauri, // Disable PWA for desktop builds
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
      ],
      manifest: {
        name: 'متابعة',
        short_name: 'متابعة',
        description: 'Offline-first mini CRM and finance tracker for freelancers.',
        theme_color: '#070C16',
        background_color: '#070C16',
        display: 'standalone',
        scope: isTauri ? '/' : '/app/',
        start_url: isTauri ? '/' : '/app',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Optional: lets you test PWA behavior during `npm run dev`
      devOptions: {
        enabled: !isTauri,
      },
    }),
  ],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    target: 'esnext',
    outDir: isTauri ? 'dist-desktop' : 'dist-web',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react/jsx-runtime'],
          'vendor-router': ['@tanstack/react-router'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-forms': ['react-hook-form', 'zod'],
          'vendor-db': ['dexie'],
        }
      }
    }
  },
})