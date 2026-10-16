declare const __APP_VERSION__: string | undefined;

/** The running app's version, injected by Vite at build time; "0.0.0" where no build defined it (tests). */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0';
