/// <reference types="vite/client" />

// Vite environment variables (empty - no custom env vars needed)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build-time constants
declare const __APP_VERSION__: string;
declare const __BUILD_MODE__: 'web' | 'desktop';

// Fontsource variable fonts
declare module '@fontsource-variable/inter';
declare module '@fontsource-variable/source-serif-4';
