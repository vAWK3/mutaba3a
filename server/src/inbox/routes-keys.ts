/**
 * The inbox's plain CRUD acts on the person, not on an organization, so these
 * carry no `X-Mutaba3a-Profile` — the same shape `GET /v1/me` and
 * `DELETE /v1/sessions/current` already have. Declared in its own module, as
 * `DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES` is, so `app.ts` merges the
 * sets and no router has to reach into another's file.
 *
 * The two filing routes are deliberately absent: the entry being filed belongs
 * to no profile, but the record it becomes belongs to exactly one, which the
 * header names.
 */
export const INBOX_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/inbox',
  'GET /v1/inbox/count',
  'POST /v1/inbox',
  'PATCH /v1/inbox/:entryId',
  'DELETE /v1/inbox/:entryId',
]);
