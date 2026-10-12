import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/**
 * MUT-66 AC 6 — "removing a user's last membership does not delete their
 * inbox" — holds because `InboxEntry` has no edge to an organization for a
 * cascade to travel along. The contract test proves the behaviour; this one
 * proves the *reason*, against the schema itself, so that a later edit adding
 * an innocent-looking `organizationId` fails here immediately instead of
 * surfacing as a support ticket about vanished entries.
 */
describe('InboxEntry ownership (MUT-66)', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'InboxEntry');

  it('is a model in the schema', () => {
    expect(model).toBeDefined();
  });

  it('belongs to a user and to nothing else', () => {
    const relations = model!.fields.filter((f) => f.kind === 'object');
    expect(relations.map((f) => f.type)).toEqual(['User']);
  });

  it('carries no organization or membership foreign key', () => {
    const scalars = model!.fields.filter((f) => f.kind !== 'object').map((f) => f.name);
    expect(scalars).toContain('userId');
    expect(scalars).not.toContain('organizationId');
    expect(scalars).not.toContain('membershipId');
  });

  it('is reachable from User, so the person owns the rows', () => {
    const user = Prisma.dmmf.datamodel.models.find((m) => m.name === 'User')!;
    expect(user.fields.some((f) => f.type === 'InboxEntry' && f.isList)).toBe(true);
  });
});
