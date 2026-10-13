import { describe, expect, it } from 'vitest';
import { wellKnownRoutes, type AppAssociationConfig } from '../routes/well-known.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

const config: AppAssociationConfig = {
  appleTeamId: '4LCWA596X7',
  appleBundleId: 'com.barmajiyat.mutaba3a',
  androidPackageName: 'com.barmajiyat.mutaba3a',
  androidSha256Fingerprints: ['AA:BB:CC', 'DD:EE:FF'],
};

const ALLOWED_PATHS = ['/p/*/expenses*', '/p/*/payments*', '/capture*'];

describe('wellKnownRoutes (MUT-111)', () => {
  const app = wellKnownRoutes(config);

  describe('GET /.well-known/apple-app-site-association', () => {
    it('answers 200, application/json, no redirect, no auth', async () => {
      const res = await app.request('/.well-known/apple-app-site-association');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('location')).toBeNull();
    });

    it('carries the app ID and exactly the three allowed paths — no /sign-in, /clients*, /documents*, /receivables*, /v1/* or /assets/*', async () => {
      const body = await read(await app.request('/.well-known/apple-app-site-association'));
      expect(body.applinks.details).toEqual([{ appID: '4LCWA596X7.com.barmajiyat.mutaba3a', paths: ALLOWED_PATHS }]);
      expect(body.webcredentials).toEqual({ apps: ['4LCWA596X7.com.barmajiyat.mutaba3a'] });
    });
  });

  describe('GET /.well-known/assetlinks.json', () => {
    it('answers 200, application/json, no redirect, no auth', async () => {
      const res = await app.request('/.well-known/assetlinks.json');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('location')).toBeNull();
    });

    it('grants handle_all_urls and get_login_creds for the Android package, with every configured fingerprint', async () => {
      const body = await read(await app.request('/.well-known/assetlinks.json'));
      expect(body).toEqual([
        {
          relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
          target: {
            namespace: 'android_app',
            package_name: 'com.barmajiyat.mutaba3a',
            sha256_cert_fingerprints: ['AA:BB:CC', 'DD:EE:FF'],
          },
        },
      ]);
    });

    it('drops blank entries from a trailing or doubled comma in the fingerprints list', async () => {
      const messy = wellKnownRoutes({ ...config, androidSha256Fingerprints: ['AA:BB:CC', '', 'DD:EE:FF', '  '] });
      const body = await read(await messy.request('/.well-known/assetlinks.json'));
      expect(body[0].target.sha256_cert_fingerprints).toEqual(['AA:BB:CC', 'DD:EE:FF']);
    });
  });
});
