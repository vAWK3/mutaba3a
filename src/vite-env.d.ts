/// <reference types="vite/client" />

// Vite environment variables
interface ImportMetaEnv {
  readonly VITE_DOWNLOAD_CONFIG_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Fontsource variable fonts
declare module '@fontsource-variable/inter';
declare module '@fontsource-variable/source-serif-4';
