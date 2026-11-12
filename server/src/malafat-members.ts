import type { MalafatRole, MembershipRole } from './repositories/ports.js';

/**
 * MUT-594 (ADR-254 D3): a Malafat role's MTB3A membership role. Partners own the firm (OWNER, which `ownsProfile`
 * reads on a Malafat firm); the office admin keeps the books; associates and interns submit. Both stores use it.
 */
export function membershipRoleOf(role: MalafatRole): MembershipRole {
  switch (role) {
    case 'PARTNER':
      return 'OWNER';
    case 'OFFICE_ADMIN':
      return 'BOOKKEEPER';
    case 'ASSOCIATE':
    case 'INTERN':
      return 'SUBMITTER';
  }
}

export const MALAFAT_ROLES = ['PARTNER', 'OFFICE_ADMIN', 'ASSOCIATE', 'INTERN'] as const satisfies readonly MalafatRole[];

/** The largest list one sync carries; a firm larger than this is not a Malafat customer today. */
export const MEMBER_SYNC_MAX = 500;
