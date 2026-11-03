// Release gate config (~/Work/tools/release-gate, web standard §4.5; MUT-551).
// Anything that relaxes a rule lives in the gate's signed exemptions, never here.
//
// web     the website (landing, /privacy, /terms, the OAuth client document) on
//         Netlify. `make deploy web` / `make release web` run
//         `release-gate web mini-crm web --env production` (scripts/netlify-deploy.sh):
//         a clean build of local main, a Netlify draft smoked with the list below,
//         then production from the same checkout, smoked again.
// portal  the hosted portal and
// api     the API, both one Cloud Run service (server/scripts/deploy.sh). The gate
//         has no Cloud Run adapter yet, so these two are report-only:
//         `make release-check` runs their smoke lists against production.
//
// Hosts come from config/hosts.json, the one place they may be written
// (scripts/__tests__/no-hardcoded-hosts.test.ts).
import fs from 'node:fs';

const hosts = JSON.parse(fs.readFileSync(new URL('../config/hosts.json', import.meta.url), 'utf8')).production;
const appHost = `${hosts.portalSubdomain}.${hosts.domain}`;

// What a Netlify page answers with: the SPA shell (pages render in the browser).
const SHELL = '<div id="root">';
// Every portal and API answer (server/src/app.ts).
const APP_HEADERS = { 'x-robots-tag': 'noindex', 'strict-transport-security': 'max-age=31536000', 'content-security-policy': "frame-ancestors 'none'" };

export default {
  // The defaults (folder name, ~/Work org), spelled out so a worktree checks as
  // the same app: signed settings and records are keyed on them.
  app: 'mini-crm',
  org: 'barmajiyat',
  platforms: [],
  web: {
    surfaces: {
      web: {
        kind: 'site',
        host: 'netlify',
        site: '95c9c629-63d0-4850-9b73-7d80199b8d75', // mutaba3a (Barmajiyat team); the Makefile's NETLIFY_SITE
        domain: hosts.domain,
        version: 'package.json',
        tagFormat: 'web-v{version}',
        locales: ['ar', 'en'],
        smoke: [
          // The landing, with the basic security headers (netlify.toml, WX-4).
          { path: '/', status: 200, text: 'og:site_name', header: { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin' } },
          // The privacy policy the store listings and the apps link to (WO-4), and the terms the apps accept.
          { path: '/privacy', status: 200, text: SHELL },
          { path: '/terms', status: 200, text: SHELL },
          // The Malafat OAuth client identity document (MUT-387): Malafat reads it from here.
          { path: '/.well-known/oauth-client.json', status: 200, text: '"client_name": "MTB3A"' },
          // MUT-445: the retired web app's links go home, and its service worker removes itself.
          { path: '/app', status: 301, header: { location: '/' } },
          { path: '/sw.js', status: 200, text: 'registration.unregister' },
          // The social card the landing names.
          { path: '/og-card-ar-1200x630.png', status: 200, header: { 'content-type': 'image/png' } },
        ],
        wrappers: [],
      },
      portal: {
        kind: 'app',
        host: 'cloudrun',
        service: 'mutaba3a-api',
        domain: appHost,
        version: 'server/package.json',
        wrappers: ['server/scripts/deploy.sh'],
        smoke: [
          { path: '/sign-in', status: 200, text: '<div id="root"', header: APP_HEADERS },
          { path: '/signup', status: 200, header: APP_HEADERS },
          { path: '/recover', status: 200, header: APP_HEADERS },
        ],
      },
      api: {
        kind: 'api',
        host: 'cloudrun',
        service: 'mutaba3a-api',
        domain: appHost,
        version: 'server/package.json',
        openapi: 'server/openapi/openapi.yaml',
        tagFormat: 'api-v{version}',
        wrappers: ['server/scripts/deploy.sh'],
        smoke: [
          { path: '/health', status: 200, text: '"status":"ok"', header: APP_HEADERS },
          { path: '/ready', status: 200, text: '"database":"ok"' },
          { path: '/v1/me', status: 401, text: 'UNAUTHENTICATED' },
          // The published contract.
          { path: '/openapi.json', status: 200, text: '"openapi"' },
        ],
      },
    },
  },
};
