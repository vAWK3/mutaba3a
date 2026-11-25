/**
 * MUT-596 / MUT-597 QA: the stub office and its people, shared by malafat-oauth.mjs (who it signs in as) and
 * malafat-seed.mjs (what MTB3A knows about them). `new` has no MTB3A account, `existing` has one with a password
 * and has never used Malafat, `linked` (the default, a partner) is already connected.
 */
export const TENANT_SLUG = process.env.MALAFAT_STUB_TENANT ?? 'sader';
export const OFFICE = { tenant_id: `tenant-${TENANT_SLUG}`, tenant_slug: TENANT_SLUG, tenant_name: 'Sader Law Office' };

export const PEOPLE = {
  new: { sub: 'malafat-nadia', email: 'nadia@sader.law', name: 'Nadia Khoury', role: 'ASSOCIATE', locale: 'ar' },
  existing: { sub: 'malafat-existing', email: 'existing@sader.law', name: 'Samer Haddad', role: 'OFFICE_ADMIN', locale: 'en' },
  linked: { sub: 'malafat-rana', email: 'rana@sader.law', name: 'Rana Sader', role: 'PARTNER', locale: 'ar' },
};

/** The `existing` person's MTB3A password, for the link step. */
export const EXISTING_PASSWORD = 'qa malafat existing passphrase';
