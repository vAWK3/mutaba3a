import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { sessionAuth, type AppEnv } from '../auth/middleware.js';
import { isMalafatFirm } from '../personal-profile.js';
import type { LedgerStore, MalafatRole, MembershipRole } from '../repositories/ports.js';
import { errorResponses } from './shared.js';
import { PERSON } from './security.js';

/**
 * MUT-596 (ADR-254 D2, AC6): who is on the selected profile, read-only. On a firm whose members Malafat syncs
 * (`memberSyncAt`) it lists Malafat's seats with their Malafat role, those not signed in to MTB3A yet included, and
 * says the list is managed in Malafat; elsewhere, the memberships. A session's, for a member of the profile (never an
 * accountant: the route carries no read scope an accountant holds).
 */

const MemberSchema = z
  .object({
    name: z.string().openapi({ description: 'The person’s display name, or a pending seat’s email' }),
    role: z.enum(['OWNER', 'BOOKKEEPER', 'SUBMITTER']).nullable().openapi({ description: 'The MTB3A role; null for a seat nobody has claimed yet' }),
    malafatRole: z.enum(['PARTNER', 'OFFICE_ADMIN', 'ASSOCIATE', 'INTERN']).nullable(),
    pending: z.boolean().openapi({ description: 'Malafat lists them, but they have not signed in to MTB3A yet' }),
    you: z.boolean(),
  })
  .openapi('ProfileMember');

const MembersSchema = z.object({ managedInMalafat: z.boolean(), items: z.array(MemberSchema) }).openapi('ProfileMembers');

type Member = z.infer<typeof MemberSchema>;

export function memberRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/members',
      tags: ['Profiles'],
      summary: 'Who is on this profile, read-only (MUT-596)',
      security: PERSON,
      responses: { 200: { description: 'Members', content: { 'application/json': { schema: MembersSchema } } }, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const nameOf = async (userId: string) => (await store.users.getById(userId))?.displayName ?? '';
      if (!isMalafatFirm(organization)) {
        const memberships = await store.memberships.listByOrganization(organization.id);
        const items: Member[] = await Promise.all(memberships.map(async (m) => ({ name: await nameOf(m.userId), role: m.role, malafatRole: null, pending: false, you: m.userId === user.id })));
        return c.json({ managedInMalafat: false, items: inListOrder(items) }, 200);
      }
      const [seats, memberships] = await Promise.all([store.externalIdentities.listByOrganization(organization.id), store.memberships.listByOrganization(organization.id)]);
      const roleOf = new Map<string, MembershipRole>(memberships.map((m) => [m.userId, m.role]));
      const items: Member[] = await Promise.all(
        seats.map(async (s) => ({
          name: s.userId ? await nameOf(s.userId) : s.email,
          role: s.userId ? (roleOf.get(s.userId) ?? null) : null,
          malafatRole: s.malafatRole as MalafatRole,
          pending: s.userId === null,
          you: s.userId === user.id,
        })),
      );
      return c.json({ managedInMalafat: true, items: inListOrder(items) }, 200);
    },
  );

  return app;
}

/** The order the list reads in: who is in MTB3A already, then pending seats; each by name (a store's order is none). */
function inListOrder(items: Member[]): Member[] {
  return [...items].sort((a, b) => Number(a.pending) - Number(b.pending) || a.name.localeCompare(b.name));
}
