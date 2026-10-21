import { z } from '@hono/zod-openapi';
import { NEW_PASSWORD_POLICY, SETUP_LINK_POLICY, SETUP_TOKEN_PATTERN } from './auth/account-setup.js';
import { SCOPES } from './auth/scopes.js';
import { ERROR_CODES } from './errors.js';
import { CONTINGENCY_OUTCOMES, MAX_COMMISSION_RATE_BASIS_POINTS, MIN_COMMISSION_RATE_BASIS_POINTS, UPFRONT_TREATMENTS } from './agreements/contingency.js';
import { DAYS_IN_FUTURE_LIMIT, DAYS_IN_PAST_LIMIT } from './agreements/compose.js';
import { GROUP_NAME_MAX, MAX_GROUP_SPAN_DAYS } from './expenses/groups.js';
import { MAX_INSTALLMENTS } from './agreements/schedule.js';
import { isValidTimezone, PAYMENT_TERMS } from './dates.js';
import { USD_PEGS } from './fx-rates.js';
import { IMPORT_MAX_ROWS } from './import/plan.js';
import { SUPPORTED_CURRENCIES } from './money.js';
import { CLIENT_RELEASE_MAX, CLIENT_RELEASE_PATTERN, TERMS_VERSION_PATTERN } from './legal.js';
import { ITEM_STATUSES } from './agreements/status.js';
import { MAX_BILLING_DAY } from './retainers/schedule.js';
import { PRICING_BASES, VAT_TREATMENTS } from './vat.js';

/**
 * Wire schemas. These are the OpenAPI components; every route references
 * them so the committed openapi.yaml is generated, never hand-edited.
 */

export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.enum(Object.keys(ERROR_CODES) as [string, ...string[]]),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string(),
    }),
  })
  .openapi('ErrorEnvelope');

export const ScopeSchema = z.enum(SCOPES).openapi('Scope');
export const CurrencySchema = z.enum(SUPPORTED_CURRENCIES).openapi('Currency');

export const OrganizationSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    defaultCurrency: CurrencySchema,
    timezone: z.string(),
    /** MUT-120: the owning user on their built-in personal profile; null on every other organization. */
    personalOwnerUserId: z.string().uuid().nullable(),
    /** MUT-182: the user who owns this profile (their personal one or one they created); null on an operator firm. An owned profile is never keyed or bound; MUT-373: an owned Business profile may have co-owners besides this creator (OWNER members). */
    ownerUserId: z.string().uuid().nullable(),
    /** MUT-182: PERSONAL or BUSINESS on an owned profile; null on an operator-provisioned organization. */
    profileType: z.enum(['PERSONAL', 'BUSINESS']).nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('Organization');

/**
 * MUT-300 (ADR-099): the organization as the operator sees it, with the firm
 * switch. Only admin routes answer with it: the firm block names the
 * requesting user, so Malafat's `/v1/integration` keeps the plain
 * `Organization`. Additive since 1.41.0-mut300.
 */
export const AdminOrganizationSchema = OrganizationSchema.extend({
  firm: z
    .object({
      /** Firm features are on from this instant; null = off. */
      enabledAt: z.string().datetime().nullable(),
      /** The owner's pending request; null when none is pending. */
      requestedAt: z.string().datetime().nullable(),
      requestedByUserId: z.string().uuid().nullable(),
    })
    .openapi('OrganizationFirm'),
}).openapi('AdminOrganization');

/** MUT-300 (ADR-099): a member's role in a firm. Read only while the organization's firm features are on. */
export const MembershipRoleSchema = z.enum(['OWNER', 'BOOKKEEPER', 'SUBMITTER']).openapi('MembershipRole');

/** MUT-300: one member as the operator sees them on the organization detail. */
export const OrganizationMemberSchema = z
  .object({ userId: z.string().uuid(), email: z.string(), role: MembershipRoleSchema })
  .openapi('OrganizationMember');

/**
 * MUT-300 (eng review D4): turn firm features on in place, or off. `ownerUserIds` names an operator firm's owners
 * (at least one, each already a member; 422 without); it is ignored on an owned profile, whose owner is the OWNER.
 */
export const UpdateOrganizationRequestSchema = z
  .union([
    z.object({ firmEnabled: z.literal(true), ownerUserIds: z.array(z.string().uuid()).max(50).optional() }).strict(),
    z.object({ firmEnabled: z.literal(false) }).strict(),
  ])
  .openapi('UpdateOrganizationRequest');

export const OrganizationResponseSchema = z.object({ organization: AdminOrganizationSchema }).openapi('OrganizationResponse');

/** MUT-300: one pending request for firm features, as the operator lists them. */
export const FirmRequestSchema = z
  .object({
    organizationId: z.string().uuid(),
    name: z.string(),
    requestedAt: z.string().datetime(),
    requestedByUserId: z.string().uuid(),
    requestedByEmail: z.string().nullable(),
    /** True on a profile a person owns (enabled in place, D4); false on an operator firm. */
    owned: z.boolean(),
  })
  .openapi('FirmRequest');

export const FirmRequestListSchema = z
  .object({ data: z.array(FirmRequestSchema), nextCursor: z.string().nullable() })
  .openapi('FirmRequestList');

/** MUT-300: what POST /v1/profiles/{profileId}/firm-request answers, the first time and on every repeat. */
export const FirmRequestResponseSchema = z
  .object({ firmRequest: z.object({ requestedAt: z.string().datetime() }) })
  .openapi('FirmRequestResponse');

/** Never includes the secret or its hash. */
export const ApiKeySummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    environment: z.enum(['live', 'test']),
    /** `mut_live_a9f3…c41d` — safe to display. */
    masked: z.string(),
    scopes: z.array(ScopeSchema),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
  })
  .openapi('ApiKeySummary');

export const IntegrationSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.enum(['MALAFAT']),
    externalTenantId: z.string(),
    displayName: z.string(),
    status: z.enum(['CONNECTED', 'DISCONNECTED']),
    connectedAt: z.string().datetime(),
    disconnectedAt: z.string().datetime().nullable(),
  })
  .openapi('Integration');

export const IntegrationStatusResponseSchema = z
  .object({
    organization: OrganizationSchema,
    apiKey: ApiKeySummarySchema,
    /** Scopes Malafat needs for the full Money experience, and which of them this key lacks. */
    requiredScopes: z.array(ScopeSchema),
    missingScopes: z.array(ScopeSchema),
    integration: IntegrationSchema.nullable(),
    server: z.object({ version: z.string(), apiVersion: z.literal('v1'), time: z.string().datetime() }),
  })
  .openapi('IntegrationStatusResponse');

export const BindIntegrationRequestSchema = z
  .object({
    provider: z.enum(['MALAFAT']),
    /** The calling system's own tenant identifier. Stable; never a hostname. */
    externalTenantId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(200),
  })
  .openapi('BindIntegrationRequest');

export const BindIntegrationResponseSchema = z
  .object({
    integration: IntegrationSchema,
    /** false when the same tenant was already connected (idempotent re-bind). */
    created: z.boolean(),
  })
  .openapi('BindIntegrationResponse');

export const DisconnectIntegrationResponseSchema = z
  .object({
    integration: IntegrationSchema,
    /** The calling key is revoked as part of disconnecting (plan §10.4). */
    apiKeyRevoked: z.literal(true),
  })
  .openapi('DisconnectIntegrationResponse');

export const HealthSchema = z
  .object({ status: z.literal('ok'), version: z.string(), time: z.string().datetime() })
  .openapi('Health');

export const ReadySchema = z
  .object({ status: z.enum(['ready', 'not_ready']), checks: z.object({ database: z.enum(['ok', 'failed']) }) })
  .openapi('Ready');

// ---- App association (MUT-111) ---------------------------------------------

export const AppleAppSiteAssociationSchema = z
  .object({
    applinks: z.object({
      details: z.array(
        z.object({
          appID: z.string(),
          paths: z.array(z.string()),
        }),
      ),
    }),
    webcredentials: z.object({ apps: z.array(z.string()) }),
  })
  .openapi('AppleAppSiteAssociation');

export const AndroidAssetLinksSchema = z
  .array(
    z.object({
      relation: z.array(z.string()),
      target: z.object({
        namespace: z.literal('android_app'),
        package_name: z.string(),
        sha256_cert_fingerprints: z.array(z.string()),
      }),
    }),
  )
  .openapi('AndroidAssetLinks');

// ---- Admin (operator) -------------------------------------------------------

export const CreateOrganizationRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/, 'lowercase letters, digits and hyphens')
      .optional(),
    defaultCurrency: CurrencySchema,
    timezone: z.string().min(1),
  })
  .openapi('CreateOrganizationRequest');

export const CreateApiKeyRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    scopes: z.array(ScopeSchema).min(1),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .openapi('CreateApiKeyRequest');

export const CreateApiKeyResponseSchema = z
  .object({
    apiKey: ApiKeySummarySchema,
    /** Shown exactly once. The service cannot reproduce it. */
    secret: z.string(),
  })
  .openapi('CreateApiKeyResponse');

export const RevokeApiKeyRequestSchema = z
  .object({ reason: z.string().min(1).max(500) })
  .openapi('RevokeApiKeyRequest');

export const OrganizationDetailSchema = z
  .object({
    organization: AdminOrganizationSchema,
    apiKeys: z.array(ApiKeySummarySchema),
    integrations: z.array(IntegrationSchema),
    /** MUT-300: everyone with access, oldest membership first, with their firm role. Additive since 1.41.0-mut300. */
    members: z.array(OrganizationMemberSchema),
  })
  .openapi('OrganizationDetail');

export const AuditEventSchema = z
  .object({
    id: z.string().uuid(),
    actorType: z.enum(['API_KEY', 'ADMIN', 'SYSTEM', 'USER']),
    actorId: z.string().nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('AuditEvent');

export const AuditListSchema = z.object({ events: z.array(AuditEventSchema) }).openapi('AuditList');

// ---- MUT-358 (ADR-160): operator billing ------------------------------------

const BillingTierSchema = z.enum(['FREELANCER', 'FIRM']).openapi('BillingTier');

/** An operator grant: covers a person's own profiles (`userId`) or one profile (`organizationId`), never both. */
export const EntitlementGrantSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid().nullable(),
    organizationId: z.string().uuid().nullable(),
    tier: BillingTierSchema,
    reason: z.string(),
    expiresAt: z.string().datetime().nullable(),
    grantedBy: z.string(),
    createdAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
  })
  .openapi('EntitlementGrant');

/** POST /admin/v1/billing/grants: exactly one of userId, userEmail and organizationId. */
export const CreateEntitlementGrantRequestSchema = z
  .object({
    userId: z.string().uuid().optional(),
    userEmail: z.string().min(3).max(320).optional(),
    organizationId: z.string().uuid().optional(),
    tier: BillingTierSchema,
    reason: z.string().trim().min(1).max(200),
    expiresAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((b) => [b.userId, b.userEmail, b.organizationId].filter((v) => v !== undefined).length === 1, 'exactly one of userId, userEmail, organizationId')
  .openapi('CreateEntitlementGrantRequest');

export const EntitlementGrantListSchema = z.object({ grants: z.array(EntitlementGrantSchema) }).openapi('EntitlementGrantList');
export const RevokeEntitlementGrantResponseSchema = z
  .object({ grant: EntitlementGrantSchema, /** false when it was already revoked: nothing changed. */ revoked: z.boolean() })
  .openapi('RevokeEntitlementGrantResponse');

/** One Stripe customer; `userId` is null until linked. */
export const BillingAccountSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid().nullable(),
    stripeCustomerId: z.string(),
    country: z.string().nullable(),
    currency: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('BillingAccount');

/** POST /admin/v1/billing/accounts/link: one of userId and userEmail; `currency` only when the customer is new here. */
export const LinkBillingAccountRequestSchema = z
  .object({
    stripeCustomerId: z.string().regex(/^cus_[A-Za-z0-9]+$/),
    userId: z.string().uuid().optional(),
    userEmail: z.string().min(3).max(320).optional(),
    currency: z.enum(['ILS', 'USD']).optional(),
  })
  .strict()
  .refine((b) => (b.userId === undefined) !== (b.userEmail === undefined), 'exactly one of userId, userEmail')
  .openapi('LinkBillingAccountRequest');

export const LinkBillingAccountResponseSchema = z
  .object({ account: BillingAccountSchema, /** false when this customer was already linked to this person: nothing changed. */ linked: z.boolean() })
  .openapi('LinkBillingAccountResponse');
export const BillingAccountListSchema = z.object({ accounts: z.array(BillingAccountSchema) }).openapi('BillingAccountList');

/** MUT-360: what the webhook answers Stripe; `result` shows in Stripe's delivery log. */
export const StripeWebhookResponseSchema = z
  .object({ received: z.literal(true), result: z.enum(['ignored', 'duplicate', 'noop', 'processed', 'error']) })
  .openapi('StripeWebhookResponse');

/** MUT-360: one reconcile run. Always 200; `errors` lists what needs the operator (subscriptionId null: listing failed). */
export const StripeReconcileSummarySchema = z
  .object({
    checked: z.number().int(),
    changed: z.number().int(),
    unlinked: z.number().int(),
    errors: z.array(z.object({ subscriptionId: z.string().nullable(), code: z.string() })),
    pruned: z.number().int(),
  })
  .openapi('StripeReconcileSummary');

// ---- Admin: operator-provisioned users (MUT-37, ADR-037) --------------------

export const UserLocaleSchema = z.enum(['en', 'ar']).openapi('UserLocale');

/** MUT-324: a terms version, named by its ISO date (server/src/legal.ts). */
export const TermsVersionSchema = z.string().regex(TERMS_VERSION_PATTERN, 'must be a terms version (YYYY-MM-DD)').openapi('TermsVersion', { example: '2026-10-19' });

/**
 * MUT-354: the client release that showed the terms (`web-v<x>` from the portal), stored as sent with the acceptance.
 * Optional: a client from before the field still accepts.
 */
const ClientReleaseSchema = z
  .string()
  .min(1)
  .max(CLIENT_RELEASE_MAX)
  .regex(CLIENT_RELEASE_PATTERN, 'must be printable ASCII with no spaces')
  .openapi({ description: 'The client release that showed the terms, e.g. the portal’s `web-v<x>` tag (MUT-354). Stored as sent.', example: 'web-v0.1.16' });

/** Never includes the password hash. */
export const UserSummarySchema = z
  .object({
    id: z.string().uuid(),
    /** Normalised: trimmed, NFKC, lower-cased. */
    email: z.string(),
    displayName: z.string(),
    locale: UserLocaleSchema,
    status: z.enum(['ACTIVE', 'DISABLED']),
    passwordChangedAt: z.string().datetime(),
    lastSignInAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('UserSummary');

export const MembershipSchema = z
  .object({
    organizationId: z.string().uuid(),
    /** MUT-300: read only while the organization's firm features are on. Additive since 1.41.0-mut300. */
    role: MembershipRoleSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('Membership');

/** MUT-235: SETUP is a person's first password; RESET an operator reset of an existing one. */
export const SetupLinkPurposeSchema = z.enum(['SETUP', 'RESET']).openapi('SetupLinkPurpose');

/** MUT-235: returned to the operator once. The token lives only in the URL's fragment; the service keeps its digest. */
export const SetupLinkSchema = z
  .object({
    url: z.string().url(),
    expiresAt: z.string().datetime(),
    purpose: SetupLinkPurposeSchema,
  })
  .openapi('SetupLink');

export const CreateUserRequestSchema = z
  .object({
    email: z.string().trim().email().max(320),
    displayName: z.string().trim().min(1).max(200),
    /** MUT-209: Arabic unless the operator asks otherwise; the portal adopts it after sign-in. */
    locale: UserLocaleSchema.default('ar').openapi({ description: 'Defaults to ar (MUT-209); the portal adopts it after sign-in.' }),
    /** The firm this user belongs to, if any. More are granted with POST /admin/v1/users/{userId}/memberships. */
    organizationId: z.string().uuid().optional(),
    /** The personal profile's currency (MUT-120). Required with no organizationId; otherwise it overrides the firm's. */
    defaultCurrency: CurrencySchema.optional(),
    /** The personal profile's IANA timezone (MUT-120). Required with no organizationId; otherwise it overrides the firm's. */
    timezone: z.string().min(1).refine(isValidTimezone, { message: 'must be an IANA timezone, e.g. Asia/Jerusalem' }).optional(),
    /** MUT-235: how long the setup link lasts; defaults to 72 hours. */
    setupLinkValidHours: z.number().int().min(SETUP_LINK_POLICY.minHours).max(SETUP_LINK_POLICY.maxHours).optional(),
  })
  .openapi('CreateUserRequest');

export const CreateUserResponseSchema = z
  .object({
    user: UserSummarySchema,
    /** The personal profile's membership first, then the firm's. */
    memberships: z.array(MembershipSchema),
    /** The user's one personal profile (MUT-120), created with them: Personal / شخصي by locale. */
    personalProfile: z.object({ id: z.string().uuid(), name: z.string() }),
    /** MUT-235: shown exactly once; deliver it to the person over a secure channel. They set their own password through it. */
    setupLink: SetupLinkSchema,
  })
  .openapi('CreateUserResponse');

export const UserDetailSchema = z
  .object({
    user: UserSummarySchema,
    memberships: z.array(MembershipSchema),
    /** MUT-66: how many unsorted entries this person is holding — a support figure, never their contents. */
    inboxEntryCount: z.number().int(),
  })
  .openapi('UserDetail');

export const UserListSchema = z.object({ users: z.array(UserSummarySchema) }).openapi('UserList');

export const GrantMembershipRequestSchema = z
  .object({
    organizationId: z.string().uuid(),
    /**
     * MUT-373 (ADR-163): OWNER makes the user a co-owner of an owned Business profile — the only way anyone is
     * granted a profile someone else owns. Omitted: a plain grant, refused on any owned profile as before.
     * Additive since 1.43.0-mut373.
     */
    role: z.enum(['OWNER']).optional(),
  })
  .openapi('GrantMembershipRequest');

export const GrantMembershipResponseSchema = z
  .object({
    membership: MembershipSchema,
    /** false when the user already had this membership (idempotent grant). */
    created: z.boolean(),
  })
  .openapi('GrantMembershipResponse');

export const RemoveMembershipResponseSchema = z
  .object({ removed: z.boolean() })
  .openapi('RemoveMembershipResponse');

export const UserStatusResponseSchema = z.object({ user: UserSummarySchema }).openapi('UserStatusResponse');

// ---- Sessions and the signed-in user (MUT-38, ADR-037) ---------------------

/**
 * The longest password any route will hand to the hasher: generous, so an old operator-set password always fits,
 * but bounded, so no one makes argon2 chew a multi-megabyte body (MUT-238 review).
 */
const PRESENTED_PASSWORD_MAX_LENGTH = 1024;

export const SignInRequestSchema = z
  .object({
    email: z.string().min(1).max(320),
    password: z.string().min(1).max(PRESENTED_PASSWORD_MAX_LENGTH),
  })
  .openapi('SignInRequest');

const AccessSchema = z.enum(['read-write', 'read', 'none']);

/** MUT-182: an owned profile's kind. It only picks the expense categories; BUSINESS is not a firm or a Malafat tenant. */
export const ProfileTypeSchema = z.enum(['PERSONAL', 'BUSINESS']).openapi('ProfileType');

/** One organization the signed-in user may open (hosted-portal.md §6). Local profiles never reach the server. */
export const HostedProfileSchema = z
  .object({
    /** The organization id; send it as X-Mutaba3a-Profile. */
    id: z.string().uuid(),
    name: z.string(),
    source: z.literal('hosted'),
    defaultCurrency: CurrencySchema,
    timezone: z.string(),
    /** MALAFAT when a connected Malafat integration records this profile's income; null when nothing does. */
    writerOfRecord: z.enum(['MALAFAT']).nullable(),
    /** The session column of the writability matrix, per domain. */
    access: z.record(z.string(), AccessSchema),
    /** MUT-61: what POST /v1/income accepts on this profile — read this, never infer it from writerOfRecord. */
    income: z
      .object({
        received: z.boolean(),
        owed: z.boolean(),
        /** For Received: `linked-required` means a client is required and must be one Malafat has linked (customer.externalReference set). */
        customer: z.enum(['optional', 'linked-required']),
      })
      .openapi('IncomeCaptureRules'),
    /** MUT-120: true on the signed-in user's own personal profile (exactly one), false everywhere else. Clients read this, not writerOfRecord. */
    isPersonalDefault: z.boolean(),
    /** MUT-182: true on a profile the caller owns (their personal one and any they created) — theirs to rename and retype with PATCH /v1/profiles/{id}. MUT-373: a Business profile they co-own too. */
    owned: z.boolean(),
    /**
     * MUT-373 (ADR-163): who owns this profile, the creator first, then co-owners in the order they joined; `[you]` on a
     * profile only you own. Null on a profile you don't own. `name` is null when the person has no display name: show
     * their email. Additive since 1.43.0-mut373.
     */
    owners: z
      .array(z.object({ userId: z.string().uuid(), name: z.string().nullable(), email: z.string(), creator: z.boolean() }).openapi('ProfileOwner'))
      .nullable(),
    /** MUT-182: PERSONAL or BUSINESS on an owned profile (it picks the expense categories); null on a profile you don't own. Unnamed, so the request-side ProfileType component stays non-null. */
    type: z.enum(['PERSONAL', 'BUSINESS']).nullable(),
    /** MUT-182: send as If-Match on PATCH /v1/profiles/{id}. */
    version: z.number().int().min(1),
    /** MUT-300 (ADR-099): true while an operator has firm features on for this profile, owned or not. Additive since 1.41.0-mut300. */
    firm: z.boolean(),
    /** MUT-300: the caller's role while `firm` is true; null otherwise. Additive since 1.41.0-mut300. */
    role: MembershipRoleSchema.nullable(),
    /** MUT-300: the owner's pending request for firm features; null when none is pending, and always null for anyone but the owner. Additive since 1.41.0-mut300. */
    firmRequestedAt: z.string().datetime().nullable(),
    /** MUT-373 (design review DR13): who asked for firm features, with `firmRequestedAt`; `name` null when unknown (no display name, or they left). Additive since 1.43.0-mut373. */
    firmRequestedBy: z.object({ userId: z.string().uuid(), name: z.string().nullable() }).nullable(),
    /**
     * MUT-358 (ADR-160): whether this profile is entitled, and why. On GET /v1/me (and the sign-in responses) it is
     * always present: null only where billing doesn't apply (the portal's signed-out mode). POST/PATCH /v1/profiles
     * omit it; read /v1/me. Nothing enforces it until MUT-361. Additive since 1.42.0-mut358; older servers omit it.
     */
    // Inline, not a ref: a ref's null is written as `nullable`, which OpenAPI 3.1 ignores (the `terms` lesson below).
    billing: z
      .object({
        /** ACTIVE: full use. GRACE: a payment failed and Stripe is retrying. READ_ONLY: reads and export only. LOCKED: an unpaid trial past day 30. */
        state: z.enum(['ACTIVE', 'GRACE', 'READ_ONLY', 'LOCKED']),
        /** What decides the state: Malafat's add-on, an operator grant, a Stripe subscription, the trial, or nothing. */
        source: z.enum(['MALAFAT', 'OPERATOR', 'STRIPE', 'TRIAL', 'NONE']),
        tier: z.enum(['FREELANCER', 'FIRM']).nullable(),
        /** When this state ends, if known: a grant's expiry, the paid period's end, the trial's end or its lock date. */
        until: z.string().datetime().nullable(),
      })
      .nullable()
      .optional(),
  })
  .openapi('HostedProfile');

/** MUT-191: a contextual Malafat suggestion a person can retire (epic MUT-189). */
export const MalafatMomentSchema = z.enum(['business-profile', 'client-threshold', 'second-business']).openapi('MalafatMoment');

export const MalafatSuggestionsSchema = z
  .object({
    /** The "Show Malafat suggestions" switch, off. */
    off: z.boolean(),
    /** Moments retired for good; only ever grows. */
    dismissed: z.array(MalafatMomentSchema),
  })
  .openapi('MalafatSuggestions');

export const MalafatSuggestionsChangeSchema = z
  .object({
    off: z.boolean().optional(),
    dismiss: z
      .array(MalafatMomentSchema)
      .min(1)
      .max(3)
      .refine((moments) => new Set(moments).size === moments.length, 'each moment once')
      .openapi({ uniqueItems: true })
      .optional(),
  })
  .strict()
  .refine((change) => change.off !== undefined || change.dismiss !== undefined, 'off or dismiss')
  // The generated spec says what the refinements enforce, so a client built from it sends nothing the server refuses
  .openapi('MalafatSuggestionsChange', { minProperties: 1 });

/** MUT-324 T1: GET /admin/v1/terms-acceptance — every user and the terms version they last accepted. */
export const TermsReportSchema = z
  .object({
    current: TermsVersionSchema,
    users: z.array(
      z.object({
        id: z.string().uuid(),
        email: z.string(),
        status: z.enum(['ACTIVE', 'DISABLED']),
        latestVersion: TermsVersionSchema.nullable(),
        /** MUT-354: the client release that showed the latest accepted version; null when none was recorded. */
        clientRelease: z.string().nullable(),
        /** The latest accepted version is the current one or newer. */
        accepted: z.boolean(),
      }),
    ),
  })
  .openapi('TermsReport');

/** MUT-324: whether the signed-in person has accepted the current terms (latest accepted version ≥ current). */
const TERMS_STATUS_SHAPE = { version: TermsVersionSchema, accepted: z.boolean() };
export const TermsStatusSchema = z.object(TERMS_STATUS_SHAPE).openapi('TermsStatus');

/** MUT-324: POST /v1/me/terms-acceptance — the version the person agreed to, the language they read it in, and (MUT-354) the client release. */
export const TermsAcceptanceRequestSchema = z
  .object({ version: TermsVersionSchema, locale: UserLocaleSchema, clientRelease: ClientReleaseSchema.optional() })
  .strict()
  .openapi('TermsAcceptanceRequest');

export const MeSchema = z
  .object({
    user: z.object({
      id: z.string().uuid(),
      email: z.string(),
      displayName: z.string(),
      locale: UserLocaleSchema,
      /** MUT-191: on, nothing dismissed, until the person changes it. */
      malafatSuggestions: MalafatSuggestionsSchema,
    }),
    /** Firm profiles in membership order (oldest first), then profiles the caller created (oldest first), then their own personal profile last (MUT-120, MUT-182). */
    profiles: z.array(HostedProfileSchema),
    /** MUT-182: how many profiles the caller owns (the personal one included) and how many they may. */
    limits: z.object({ ownedProfiles: z.number().int().min(0), maxOwnedProfiles: z.number().int().min(1) }).openapi('ProfileLimits'),
    /**
     * MUT-280 (ADR-098): plain three-letter strings, not the Currency enum, so a client built against this spec
     * never rejects a code a newer server adds.
     */
    currencies: z
      .array(z.string().regex(/^[A-Z]{3}$/))
      .openapi({
        description:
          'Every currency code this server accepts, in its supported order. Clients offer only the codes they also know and ignore the rest. Servers older than MUT-280 omit the field.',
        example: [...SUPPORTED_CURRENCIES],
      }),
    /**
     * MUT-324: the current terms and whether this person accepted them. Null where no terms apply (the portal's
     * signed-out mode). Servers older than MUT-324 omit the field; clients treat that like null.
     */
    // Inline, not the TermsStatus ref: the generator writes a ref's null as `nullable`, which OpenAPI 3.1 ignores,
    // so the portal's generated type lost the null (review pass 2). Inline, it is `type: [object, null]`.
    terms: z.object(TERMS_STATUS_SHAPE).nullable(),
  })
  .openapi('Me');

const profileName = z.string().trim().min(1).max(80);

/** MUT-182: POST /v1/profiles — a standalone profile the caller will own. Never a Malafat organization; nothing here can link one. */
export const CreateProfileRequestSchema = z
  .object({
    name: profileName,
    type: ProfileTypeSchema,
    defaultCurrency: CurrencySchema,
    timezone: z.string().min(1).refine(isValidTimezone, { message: 'must be an IANA timezone, e.g. Asia/Jerusalem' }),
  })
  .strict()
  .openapi('CreateProfileRequest');

/** MUT-182: PATCH /v1/profiles/{id}. A changed `type` replaces the profile's expense categories (preview it first). */
export const UpdateProfileRequestSchema = z
  .object({ name: profileName.optional(), defaultCurrency: CurrencySchema.optional(), type: ProfileTypeSchema.optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one of name, defaultCurrency, type' })
  .openapi('UpdateProfileRequest');

export const ProfileIdParamSchema = z.object({ profileId: z.string().uuid().openapi({ param: { name: 'profileId', in: 'path' } }) });

/** MUT-373: DELETE /v1/profiles/{profileId}/owners/{userId} — yourself to leave, a co-owner to remove them. */
export const ProfileOwnerParamSchema = ProfileIdParamSchema.extend({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) });

/** MUT-373: `left` when you named yourself, `removed` when you named a co-owner. */
export const RemoveProfileOwnerResponseSchema = z.object({ result: z.enum(['left', 'removed']) }).openapi('RemoveProfileOwnerResponse');

export const ProfileTypeChangeQuerySchema = z.object({ to: ProfileTypeSchema });

/** MUT-182: what changing a profile's type does — or did — to its expenses and categories. */
const profileTypeChangeShape = {
  /** Live expenses that had a category and are left uncategorized. */
  uncategorizedExpenses: z.number().int().min(0),
  /** Every category the profile had, custom and archived ones included. */
  deletedCategories: z.number().int().min(0),
  /** The preset that replaces them. */
  preset: z.enum(['lawFirm', 'personal', 'general']),
};
export const ProfileTypeChangeSchema = z.object(profileTypeChangeShape).openapi('ProfileTypeChange');

export const UpdateProfileResponseSchema = z
  // An unnamed copy, so making it nullable here can't make the preview's ProfileTypeChange component nullable too.
  .object({ profile: HostedProfileSchema, typeChange: z.object(profileTypeChangeShape).nullable() })
  .openapi('UpdateProfileResponse');

/** POST /v1/device-sessions response (MUT-64): the bearer token a native app stores, plus the same Me payload the portal gets from its cookie. */
export const DeviceSessionSchema = MeSchema.extend({
  /** Authorization: Bearer <token> on every subsequent request. Shown once; the server keeps only its digest. */
  token: z.string(),
}).openapi('DeviceSession');

export const RevokeSessionsResponseSchema = z.object({ revoked: z.number().int().min(0) }).openapi('RevokeSessionsResponse');

// ---- One-time setup links (MUT-235, ADR-088) -------------------------------

/** NIST SP 800-63B length rule; no composition rules. Length is counted in UTF-16 units, so an emoji counts as two. */
export const NewPasswordSchema = z
  .string()
  .min(NEW_PASSWORD_POLICY.minLength)
  .max(NEW_PASSWORD_POLICY.maxLength)
  .openapi('NewPassword', { description: `${NEW_PASSWORD_POLICY.minLength} to ${NEW_PASSWORD_POLICY.maxLength} characters; no composition rules.` });

const SetupTokenSchema = z.string().regex(SETUP_TOKEN_PATTERN, 'must be a setup-link token');

const ValidHoursSchema = z.number().int().min(SETUP_LINK_POLICY.minHours).max(SETUP_LINK_POLICY.maxHours);

export const IssueSetupLinkRequestSchema = z
  .object({
    /** Defaults to 72. */
    validHours: ValidHoursSchema.optional(),
    /** A suspected takeover: the current password stops working and every session is signed out now, not when the link is used. */
    lock: z.boolean().default(false),
  })
  .openapi('IssueSetupLinkRequest');

export const IssueSetupLinkResponseSchema = z
  .object({
    user: UserSummarySchema,
    setupLink: SetupLinkSchema,
    /** Whether the password was cleared and every session revoked by this call: what the server did, not what was asked. */
    lock: z.boolean(),
  })
  .openapi('IssueSetupLinkResponse');

export const SetupLinkCheckRequestSchema = z.object({ token: SetupTokenSchema }).openapi('SetupLinkCheckRequest');

export const SetupLinkCheckResponseSchema = z
  .discriminatedUnion('state', [
    z.object({
      state: z.literal('valid'),
      email: z.string(),
      locale: UserLocaleSchema,
      purpose: SetupLinkPurposeSchema,
      expiresAt: z.string().datetime(),
      /** MUT-324: the terms version the setup page shows and sends back as `acceptedTermsVersion`. */
      termsVersion: TermsVersionSchema,
    }),
    z.object({ state: z.enum(['expired', 'used', 'superseded', 'invalid']) }),
  ])
  .openapi('SetupLinkCheckResponse');

export const SetupLinkRedeemRequestSchema = z
  .object({
    token: SetupTokenSchema,
    password: NewPasswordSchema,
    /**
     * MUT-324: the terms version the person ticked "I agree" to (the check's `termsVersion`). Optional in the schema
     * so a page opened before the terms existed gets 409 TERMS_VERSION_STALE, not a password-policy 422.
     */
    acceptedTermsVersion: TermsVersionSchema.optional(),
    /** The language of the terms text the person read; the account's language when omitted. */
    termsLocale: UserLocaleSchema.optional(),
    /** MUT-354: the client release that showed the setup page. */
    clientRelease: ClientReleaseSchema.optional(),
  })
  .openapi('SetupLinkRedeemRequest');

/** The portal signs in with this email and the password just set, through POST /v1/sessions. */
export const SetupLinkRedeemResponseSchema = z.object({ email: z.string() }).openapi('SetupLinkRedeemResponse');

// ---- Changing your own password (MUT-237) ----------------------------------

/**
 * `currentPassword` has no floor: it is whatever the person's existing
 * password already is, which may predate the 12-char floor (an operator-set
 * password from before MUT-235) — a minimum would wrongly reject a correct
 * old password. It has sign-in's ceiling, so the hasher never sees more.
 */
export const ChangePasswordRequestSchema = z
  .object({ currentPassword: z.string().max(PRESENTED_PASSWORD_MAX_LENGTH), newPassword: NewPasswordSchema })
  .openapi('ChangePasswordRequest');

// ---- Milestone 2: customers, projects, import --------------------------------

export const ProviderSchema = z.enum(['MALAFAT']).openapi('Provider');
export const EntityStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']).openapi('EntityStatus');

export const ExternalReferenceSchema = z
  .object({
    provider: ProviderSchema,
    /** The external system's own id for this entity (Malafat: the client or matter uuid). */
    externalId: z.string().min(1).max(128),
  })
  .openapi('ExternalReference');

const name = z.string().min(1).max(200);
const email = z.string().email().max(254);
const phone = z.string().min(1).max(64);
const notes = z.string().max(4000);
const uuid = z.string().uuid();

export const VatTreatmentSchema = z.enum(VAT_TREATMENTS).openapi('VatTreatment');
export const PricingBasisSchema = z.enum(PRICING_BASES).openapi('PricingBasis');
export const PaymentTermsSchema = z.enum(PAYMENT_TERMS).openapi('PaymentTerms');
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').openapi({ description: 'Calendar date in the organization timezone, YYYY-MM-DD' });

/** MUT-227: the money-date rules, said once for every request field that carries them. */
const PAST_MONEY_DATE = `Calendar date in the organization timezone, YYYY-MM-DD. Not later than the organization's today and not more than ten years (${DAYS_IN_PAST_LIMIT} days) before it: 422 DATE_INVALID with details.bound future or past.`;
const FLOORED_MONEY_DATE = `Calendar date in the organization timezone, YYYY-MM-DD. Not more than ten years (${DAYS_IN_PAST_LIMIT} days) before the organization's today: 422 DATE_INVALID with details.bound past.`;
const PastMoneyDateSchema = IsoDateSchema.openapi({ description: PAST_MONEY_DATE });
const FlooredMoneyDateSchema = IsoDateSchema.openapi({ description: FLOORED_MONEY_DATE });
/** MUT-227: a PATCH re-checks the date only when it changes, so a row stored before the floor stays editable. */
const UNCHANGED_NOT_CHECKED = ' Checked only when it differs from the stored date.';
const FlooredMoneyDatePatchSchema = IsoDateSchema.openapi({ description: FLOORED_MONEY_DATE + UNCHANGED_NOT_CHECKED });
const PastMoneyDatePatchSchema = IsoDateSchema.openapi({ description: PAST_MONEY_DATE + UNCHANGED_NOT_CHECKED });
const BoundedMoneyDateSchema = IsoDateSchema.openapi({ description: `Calendar date in the organization timezone, YYYY-MM-DD. Not more than ten years (${DAYS_IN_PAST_LIMIT} days) before the organization's today nor ten years (${DAYS_IN_FUTURE_LIMIT} days) after it: 422 DATE_INVALID with details.bound past or future. The first replacement of a reversed payment (replacesPaymentId, none posted yet) may keep that payment's receivedOn, or a later one, below the floor.` });
export const IsoMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').openapi({ description: 'Calendar month, YYYY-MM' });
/** Canonical decimal amount in the project currency, e.g. "10000.00". Validated against the currency exponent server-side. */
export const AmountSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'canonical decimal').openapi({ description: 'Canonical decimal string; exactly the currency\'s fractional digits; at most 999999999999999 minor units either sign (9999999999999.99 in a 2-decimal currency), else 422 AMOUNT_INVALID' });

export const CustomerSchema = z
  .object({
    id: uuid,
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    notes: z.string().nullable(),
    /** Default VAT treatment for this customer's items (e.g. OUT_OF_SCOPE for a foreign client). */
    vatTreatment: VatTreatmentSchema.nullable(),
    status: EntityStatusSchema,
    archivedAt: z.string().datetime().nullable(),
    externalReference: ExternalReferenceSchema.nullable(),
    /** Send back as `If-Match` on PATCH. */
    version: z.number().int().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Customer');

export const CreateCustomerRequestSchema = z
  .object({
    name,
    email: email.optional(),
    phone: phone.optional(),
    notes: notes.optional(),
    vatTreatment: VatTreatmentSchema.optional(),
    /** When present and already known, the existing customer is returned (200) instead of a duplicate. */
    externalReference: ExternalReferenceSchema.optional(),
  })
  .openapi('CreateCustomerRequest');

export const UpdateCustomerRequestSchema = z
  .object({
    name: name.optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    notes: notes.nullable().optional(),
    vatTreatment: VatTreatmentSchema.nullable().optional(),
  })
  .strict()
  .openapi('UpdateCustomerRequest');

export const ProjectSchema = z
  .object({
    id: uuid,
    customerId: uuid,
    name: z.string(),
    currency: CurrencySchema,
    /** Default VAT treatment for this project's items; null inherits the customer's. */
    vatTreatment: VatTreatmentSchema.nullable(),
    status: EntityStatusSchema,
    archivedAt: z.string().datetime().nullable(),
    externalReference: ExternalReferenceSchema.nullable(),
    version: z.number().int().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Project');

export const CreateProjectRequestSchema = z
  .object({
    customerId: uuid,
    name,
    currency: CurrencySchema,
    vatTreatment: VatTreatmentSchema.optional(),
    externalReference: ExternalReferenceSchema.optional(),
  })
  .openapi('CreateProjectRequest');

export const UpdateProjectRequestSchema = z
  .object({
    name: name.optional(),
    /** Accepted only while the project has no agreement (409 CURRENCY_LOCKED otherwise). */
    currency: CurrencySchema.optional(),
    vatTreatment: VatTreatmentSchema.nullable().optional(),
  })
  .strict()
  .openapi('UpdateProjectRequest');

const pageQuery = {
  limit: z.coerce.number().int().min(1).max(200).default(50).openapi({ description: 'Page size, 1–200.' }),
  cursor: z.string().optional().openapi({ description: 'Opaque `nextCursor` from the previous page.' }),
};

export const ListCustomersQuerySchema = z.object({
  ...pageQuery,
  status: EntityStatusSchema.optional(),
  provider: ProviderSchema.default('MALAFAT'),
  externalId: z.string().min(1).max(128).optional(),
});

export const ListProjectsQuerySchema = z.object({
  ...pageQuery,
  status: EntityStatusSchema.optional(),
  customerId: uuid.optional(),
  currency: CurrencySchema.optional(),
  provider: ProviderSchema.default('MALAFAT'),
  externalId: z.string().min(1).max(128).optional(),
});

export const CustomerPageSchema = z.object({ items: z.array(CustomerSchema), nextCursor: z.string().nullable() }).openapi('CustomerPage');
export const ProjectPageSchema = z.object({ items: z.array(ProjectSchema), nextCursor: z.string().nullable() }).openapi('ProjectPage');

export const CustomerIdParamSchema = z.object({ customerId: uuid });
export const ProjectIdParamSchema = z.object({ projectId: uuid });

export const IfMatchHeaderSchema = z.object({
  'if-match': z.string().openapi({ description: 'The `version` you read. A stale version is refused with 409 CONFLICT / VERSION_MISMATCH.' }),
});

const ImportCustomerRowSchema = z.object({
  entityType: z.literal('CUSTOMER'),
  externalId: z.string().min(1).max(128),
  /** Validated per row (empty or over 200 chars → row conflict VALIDATION), never as a whole-request error. */
  name: z.string().max(1000),
  email: email.optional(),
  phone: phone.optional(),
});

const ImportProjectRowSchema = z.object({
  entityType: z.literal('PROJECT'),
  externalId: z.string().min(1).max(128),
  name: z.string().max(1000),
  /** Validated per row against the supported currencies. */
  currency: z.string().min(1).max(8),
  customerExternalId: z.string().min(1).max(128),
});

export const ImportRowSchema = z.discriminatedUnion('entityType', [ImportCustomerRowSchema, ImportProjectRowSchema]).openapi('ImportRow');

export const ImportPreviewRequestSchema = z
  .object({ provider: ProviderSchema, rows: z.array(ImportRowSchema).max(IMPORT_MAX_ROWS) })
  .openapi('ImportPreviewRequest');

export const ImportPlanRowSchema = z
  .object({
    index: z.number().int(),
    entityType: z.enum(['CUSTOMER', 'PROJECT']),
    externalId: z.string(),
    action: z.enum(['create', 'link', 'conflict']),
    existingId: uuid.optional(),
    reason: z.enum(['UNKNOWN_CUSTOMER', 'CUSTOMER_MISMATCH', 'CURRENCY_DIFFERS', 'VALIDATION']).optional(),
    detail: z.enum(['EMPTY_NAME', 'NAME_TOO_LONG', 'UNSUPPORTED_CURRENCY', 'DUPLICATE_IN_BATCH']).optional(),
    warnings: z.array(z.enum(['NAME_DIFFERS', 'ARCHIVED'])),
  })
  .openapi('ImportPlanRow');

export const ImportPreviewResponseSchema = z
  .object({
    rows: z.array(ImportPlanRowSchema),
    totals: z.object({ create: z.number().int(), link: z.number().int(), conflict: z.number().int() }),
    /** Required by commit; proves the caller previewed exactly these rows. */
    previewToken: z.string().length(64),
  })
  .openapi('ImportPreviewResponse');

export const ImportCommitRequestSchema = ImportPreviewRequestSchema.extend({ previewToken: z.string().length(64) }).openapi('ImportCommitRequest');

export const ImportCommitRowSchema = z
  .object({
    index: z.number().int(),
    entityType: z.enum(['CUSTOMER', 'PROJECT']),
    externalId: z.string(),
    outcome: z.enum(['created', 'linked', 'failed']),
    id: uuid.optional(),
    reason: z.string().optional(),
    warnings: z.array(z.enum(['NAME_DIFFERS', 'ARCHIVED'])),
  })
  .openapi('ImportCommitRow');

export const ImportCommitResponseSchema = z
  .object({
    rows: z.array(ImportCommitRowSchema),
    totals: z.object({ created: z.number().int(), linked: z.number().int(), failed: z.number().int() }),
  })
  .openapi('ImportCommitResponse');

/** Published `details.reason` values for 409 CONFLICT responses (brief §2.2). */
export const CONFLICT_REASONS = [
  'VERSION_MISMATCH',
  'CURRENCY_LOCKED',
  'CUSTOMER_MISMATCH',
  'HAS_ACTIVE_PROJECTS',
  'PREVIEW_STALE',
  'INTEGRATION_NOT_CONNECTED',
  // M3
  'RATE_ALREADY_SET',
  'AGREEMENT_HAS_POSTED_RECEIVABLES',
  'AGREEMENT_CANCELLED',
  'PROJECT_HAS_OUTSTANDING',
  // M4
  'ALREADY_REVERSED',
  // M7
  'PROPOSAL_OPEN',
  'PROPOSAL_NOT_OPEN',
  // MUT-42
  'CATEGORY_NAME_TAKEN',
  // MUT-65
  'ALREADY_SETTLED',
  'ALREADY_ALLOCATED',
  // MUT-61: a capture's undo, after the integration reversed it.
  'REVERSED_BY_MALAFAT',
  // MUT-66: filing an entry through the route for the other kind.
  'ENTRY_KIND_MISMATCH',
  // MUT-100: contingency outcomes
  'OUTCOME_ALREADY_RECORDED',
  'OUTCOME_NOT_RECORDED',
  'OUTCOME_HAS_PAYMENTS',
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/** Published `details.reason` values for 422 VALIDATION_FAILED responses raised by business rules (M3). */
export const VALIDATION_REASONS = [
  'AMOUNT_INVALID',
  'VAT_RATE_MISSING',
  'INSTALLMENTS_DO_NOT_SUM',
  'PERCENTS_DO_NOT_SUM',
  'MIXED_INSTALLMENT_BASIS',
  'NO_INSTALLMENTS',
  'TOO_MANY_INSTALLMENTS',
  'NON_POSITIVE_INSTALLMENT',
  'CURRENCY_MISMATCH',
  'PROJECT_ARCHIVED',
  'CUSTOMER_ARCHIVED',
  'NOT_MANUAL',
  'NOT_FIXED',
  'NOT_RECURRING',
  'SUPPLEMENT_EXCEEDS_UNPOSTED',
  'NEW_INSTALLMENT_REQUIRED',
  'NEGATIVE_NEW_INSTALLMENT',
  'BILLING_DAY_INVALID',
  'START_MONTH_INVALID',
  'END_MONTH_INVALID',
  'END_BEFORE_START',
  'DATE_INVALID',
  'TRIGGER_DATE_REQUIRED',
  // M4
  'ALLOCATION_EXCEEDS_PAYMENT',
  'ALLOCATION_EXCEEDS_OUTSTANDING',
  'ALLOCATION_DUPLICATE',
  'RECEIVABLE_NOT_FOUND',
  'RECEIVABLE_NOT_OPEN',
  'RECEIVABLE_CUSTOMER_MISMATCH',
  'PAYMENT_NOT_POSTED',
  'NO_UNALLOCATED_FUNDS',
  'CREDIT_EXCEEDS_OUTSTANDING',
  'REPLACES_NOT_REVERSED',
  'REPLACES_CUSTOMER_MISMATCH',
  'NO_ELIGIBLE_RECEIVABLES',
  'CUSTOMER_NOT_FOUND',
  // M5
  'CHANGE_EFFECTIVE_INVALID',
  'CHANGE_NOTHING_CHANGED',
  'FINAL_MONTH_INVALID',
  'PREVIEW_TOKEN_REQUIRED',
  // M6
  'UPLOAD_INCOMPLETE',
  'UPLOAD_MISMATCH',
  'ATTACHMENT_TARGET_REQUIRED',
  'ATTACHMENT_TARGET_AMBIGUOUS',
  'MIME_TYPE_UNSUPPORTED',
  'FILE_TOO_LARGE',
  'FILENAME_INVALID',
  'ATTACHMENT_NOT_READY',
  // M7
  'PROJECT_NOT_FOUND',
  // MUT-38: a session request to an organization-scoped route without X-Mutaba3a-Profile
  'PROFILE_REQUIRED',
  // MUT-42: expenses on hosted profiles
  'PROJECT_CUSTOMER_MISMATCH',
  'CATEGORY_NOT_FOUND',
  'CATEGORY_ARCHIVED',
  'TOO_MANY_RECEIPTS',
  // MUT-65: personal profile income capture
  'CUSTOMER_REQUIRED_FOR_OWED',
  // MUT-61: Received on a Malafat-fed profile
  'CUSTOMER_REQUIRED',
  'CUSTOMER_NOT_LINKED',
  'REASON_RESERVED',
  'EXTERNAL_REFERENCE_NOT_ALLOWED',
  'PAYMENT_HAS_NO_CUSTOMER',
  // MUT-100: contingency agreements
  'COMMISSION_RATE_INVALID',
  'NOT_CONTINGENCY',
  'OUTCOME_DATE_INVALID',
  'COMMISSION_LABEL_REQUIRED',
  // MUT-107: contingency fee proposals
  'SCHEDULE_REQUIRED',
  // MUT-267: expense groups
  'NAME_REQUIRED',
  'GROUP_RANGE_TOO_LONG',
  'GROUP_LIMIT',
  'GROUP_ID_REQUIRED',
  // MUT-194 (ADR-075) / MUT-272 (ADR-096): a currency travels with its amount; a conversion's legs differ
  'AMOUNT_REQUIRED',
  'SAME_CURRENCY',
] as const;

// ---- Milestone 3: VAT rates, agreements, installments, retainers, receivables ----

export const ItemStatusSchema = z.enum(ITEM_STATUSES).openapi('ItemStatus');
export const FinalMonthSchema = z.enum(['FULL', 'PRORATE', 'WAIVE']).openapi('FinalMonth');
export const TriggerTypeSchema = z.enum(['IMMEDIATE', 'DATE', 'MANUAL']).openapi('TriggerType');
/** MUT-100: CONTINGENCY = an upfront fee plus a commission on the award, billed when the outcome is recorded. */
export const AgreementTypeSchema = z.enum(['FIXED', 'RECURRING', 'CONTINGENCY']).openapi('AgreementType');
/** MUT-100: SEPARATE = the upfront stays on top of the commission; CREDITED = it counts toward the commission (never refunded). */
export const UpfrontTreatmentSchema = z.enum(UPFRONT_TREATMENTS).openapi('UpfrontTreatment');
export const ContingencyOutcomeSchema = z.enum(CONTINGENCY_OUTCOMES).openapi('ContingencyOutcome');
export const ContingencyTermsSchema = z
  .object({
    commissionRateBasisPoints: z.number().int().openapi({ description: `The commission on the award, ${MIN_COMMISSION_RATE_BASIS_POINTS}..${MAX_COMMISSION_RATE_BASIS_POINTS} (2000 = 20 %); outside that range 422 COMMISSION_RATE_INVALID` }),
    upfrontTreatment: UpfrontTreatmentSchema,
  })
  .openapi('ContingencyTerms');

/** "0.709 JOD, 3.6725 AED, …" for the `derived` description (MUT-280, ADR-098). */
const PEG_LIST = Object.entries(USD_PEGS).map(([currency, peg]) => `${peg} ${currency}`).join(', ');

/** MUT-228 (ADR-087): reference exchange rates for display. Never stored on a record. */
export const FxRatesQuerySchema = z.object({
  base: CurrencySchema.openapi({ description: 'The currency the rates are quoted against; the phone sends the target profile’s default currency' }),
});
export const FxRateSchema = z
  .object({
    currency: CurrencySchema,
    rate: z.number().positive().openapi({ description: 'Units of `currency` per 1 `base`, rounded to 6 decimal places', example: 0.322356 }),
    derived: z.boolean().openapi({ description: `True when either side of the pair is pegged to the US dollar (never base→base): the ECB publishes no rate for it, so the rate comes from its USD peg (1 USD = ${PEG_LIST})` }),
  })
  .openapi('FxRate');
export const FxRatesResponseSchema = z
  .object({
    base: CurrencySchema,
    rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ description: 'The ECB reference date the rates are for (its last business day), YYYY-MM-DD', example: '2026-10-15' }),
    fetchedAt: z.string().datetime().openapi({ description: 'When this server instance read the rates from the provider' }),
    source: z.enum(['live', 'stale']).openapi({ description: 'live = inside the cache window; stale = the last refresh failed and these are the last good rates' }),
    rates: z.array(FxRateSchema).openapi({ description: 'Every supported currency, base included (rate 1), in the supported-currency order' }),
  })
  .openapi('FxRatesResponse');

/** MUT-287 (MUT-285 D3): the raw ECB snapshot behind /v1/fx-rates, for the portal's signed-out mode to run the same crossRates in the page. */
export const PublicFxRatesResponseSchema = z
  .object({
    rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ description: 'The ECB reference date (its last business day), YYYY-MM-DD', example: '2026-10-15' }),
    perEur: z
      .object({ USD: z.number().positive(), ILS: z.number().positive() })
      .openapi({ description: 'Units of each currency per 1 EUR, as the ECB publishes them. Every other supported currency derives from these and the USD pegs.' }),
    fetchedAt: z.string().datetime().openapi({ description: 'When this server instance read the rates from the provider' }),
    source: z.enum(['live', 'stale']).openapi({ description: 'live = inside the cache window; stale = the last refresh failed and these are the last good rates' }),
  })
  .openapi('PublicFxRatesResponse');

export const VatRateSchema = z
  .object({ id: uuid, rateBasisPoints: z.number().int().min(0).max(10000), effectiveFrom: IsoDateSchema, createdAt: z.string().datetime() })
  .openapi('VatRate');
export const VatRatesResponseSchema = z.object({ rates: z.array(VatRateSchema), current: VatRateSchema.nullable() }).openapi('VatRatesResponse');
export const SetVatRateRequestSchema = z
  .object({ rateBasisPoints: z.number().int().min(0).max(10000).openapi({ description: '1800 = 18 %' }), effectiveFrom: IsoDateSchema })
  .openapi('SetVatRateRequest');

export const InstallmentTriggerSchema = z
  .object({ type: TriggerTypeSchema, date: IsoDateSchema.optional() })
  .openapi('InstallmentTrigger');

export const InstallmentSpecSchema = z
  .object({
    label: z.string().min(1).max(80),
    /** Exactly one of amount / percentBasisPoints, the same choice for every installment. */
    amount: AmountSchema.optional(),
    percentBasisPoints: z.number().int().min(0).max(10000).optional(),
    vatTreatment: VatTreatmentSchema.optional(),
    trigger: InstallmentTriggerSchema,
    paymentTerms: PaymentTermsSchema.optional(),
    dueDate: IsoDateSchema.optional(),
  })
  .openapi('InstallmentSpec');

export const AgreementPreviewRequestSchema = z
  .object({
    projectId: uuid,
    /** Contractual amount in the pricing basis, project currency. With `contingency`: the upfront, which may be 0 (then `installments` is empty). */
    amount: AmountSchema,
    currency: CurrencySchema.optional(),
    pricingBasis: PricingBasisSchema,
    /** Default for the installments; absent = project → customer → STANDARD_RATED. */
    vatTreatment: VatTreatmentSchema.optional(),
    agreementDate: IsoDateSchema,
    description: z.string().max(500).optional(),
    paymentTerms: PaymentTermsSchema.default('EOM'),
    /** An empty list is 422 NO_INSTALLMENTS unless this is a contingency agreement with a 0 upfront. */
    installments: z.array(InstallmentSpecSchema).max(MAX_INSTALLMENTS),
    /** MUT-100: present = a CONTINGENCY agreement (upfront in `amount`, commission on the award when the outcome is recorded); absent = FIXED. */
    contingency: ContingencyTermsSchema.optional(),
  })
  .openapi('AgreementPreviewRequest');

export const AgreementCreateRequestSchema = AgreementPreviewRequestSchema.extend({
  previewToken: z.string().length(64),
}).openapi('AgreementCreateRequest');

export const InstallmentSchema = z
  .object({
    id: uuid,
    position: z.number().int(),
    label: z.string(),
    amount: AmountSchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    vatTreatment: VatTreatmentSchema,
    rateBasisPoints: z.number().int(),
    trigger: InstallmentTriggerSchema,
    paymentTerms: PaymentTermsSchema.nullable(),
    /** Due date once posted; before posting, the date it would get if posted today. */
    dueDate: IsoDateSchema,
    status: ItemStatusSchema,
    postedAt: z.string().datetime().nullable(),
    receivableId: uuid.nullable(),
    /** MUT-100: the commission line a contingency outcome posted. */
    isCommission: z.boolean(),
    version: z.number().int(),
  })
  .openapi('Installment');

export const SupplementSchema = z
  .object({
    id: uuid,
    amount: AmountSchema,
    description: z.string().nullable(),
    effectiveDate: IsoDateSchema,
    distribution: z.enum(['LAST_UNPOSTED', 'PRORATE_UNPOSTED', 'NEW_INSTALLMENT']),
    resultingAmount: AmountSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('Supplement');

export const AgreementSchema = z
  .object({
    id: uuid,
    projectId: uuid,
    customerId: uuid,
    type: AgreementTypeSchema,
    status: z.enum(['ACTIVE', 'CANCELLED']),
    currency: CurrencySchema,
    pricingBasis: PricingBasisSchema,
    vatTreatment: VatTreatmentSchema,
    vatRateBasisPoints: z.number().int(),
    /** FIXED: contractual total. RECURRING: monthly amount. Pricing basis as given. */
    amount: AmountSchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    agreementDate: IsoDateSchema,
    description: z.string().nullable(),
    paymentTerms: PaymentTermsSchema,
    retainer: z
      .object({ startMonth: IsoMonthSchema, billingDay: z.number().int(), endMonth: IsoMonthSchema.nullable(), cancelEffectiveMonth: IsoMonthSchema.nullable(), cancelEffectiveDate: IsoDateSchema.nullable(), finalMonth: z.enum(['FULL', 'PRORATE', 'WAIVE']).nullable() })
      .nullable(),
    /** MUT-100: CONTINGENCY only; null on every other type. */
    contingency: z
      .object({
        commissionRateBasisPoints: z.number().int(),
        upfrontTreatment: UpfrontTreatmentSchema,
        outcome: z.enum(['AWAITING', ...CONTINGENCY_OUTCOMES]),
        outcomeDate: IsoDateSchema.nullable(),
        /** AWARDED: the award, in the pricing basis. */
        awarded: AmountSchema.nullable(),
        note: z.string().nullable(),
        outcomeRecordedAt: z.string().datetime().nullable(),
      })
      .nullable()
      .openapi('AgreementContingency'),
    cancelledAt: z.string().datetime().nullable(),
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Agreement');

export const AgreementDetailSchema = z
  .object({ agreement: AgreementSchema, installments: z.array(InstallmentSchema), supplements: z.array(SupplementSchema) })
  .openapi('AgreementDetail');

export const AgreementPreviewResponseSchema = z
  .object({
    /** MUT-100: CONTINGENCY when the request carried `contingency`. */
    type: z.enum(['FIXED', 'CONTINGENCY']),
    contingency: ContingencyTermsSchema.nullable(),
    totals: z.object({ amount: AmountSchema, net: AmountSchema, vat: AmountSchema, gross: AmountSchema }),
    vatRateBasisPoints: z.number().int(),
    vatTreatment: VatTreatmentSchema,
    currency: CurrencySchema,
    installments: z.array(InstallmentSchema.omit({ id: true, postedAt: true, receivableId: true, version: true })),
    previewToken: z.string().length(64),
  })
  .openapi('AgreementPreviewResponse');

export const AgreementPageSchema = z.object({ items: z.array(AgreementSchema), nextCursor: z.string().nullable() }).openapi('AgreementPage');

export const ListAgreementsQuerySchema = z.object({
  ...pageQuery,
  projectId: uuid.optional(),
  customerId: uuid.optional(),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
  type: AgreementTypeSchema.optional(),
});

export const AgreementIdParamSchema = z.object({ agreementId: uuid });
export const InstallmentIdParamSchema = z.object({ installmentId: uuid });
export const ReceivableIdParamSchema = z.object({ receivableId: uuid });

export const SupplementRequestSchema = z
  .object({
    /** Signed, in the agreement's pricing basis and currency. */
    amount: AmountSchema,
    description: z.string().max(500).optional(),
    effectiveDate: IsoDateSchema,
    distribution: z.enum(['LAST_UNPOSTED', 'PRORATE_UNPOSTED', 'NEW_INSTALLMENT']),
    newInstallment: z
      .object({ label: z.string().min(1).max(80), vatTreatment: VatTreatmentSchema.optional(), trigger: InstallmentTriggerSchema, paymentTerms: PaymentTermsSchema.optional(), dueDate: IsoDateSchema.optional() })
      .optional(),
  })
  .openapi('SupplementRequest');

export const SupplementResponseSchema = z
  .object({
    agreement: AgreementSchema,
    supplement: SupplementSchema,
    installments: z.array(InstallmentSchema),
    effect: z.object({ contractualDelta: AmountSchema, installmentsChanged: z.array(uuid), installmentsCreated: z.array(uuid) }),
  })
  .openapi('SupplementResponse');

export const TriggerInstallmentRequestSchema = z.object({ dueDate: IsoDateSchema.optional() }).openapi('TriggerInstallmentRequest');
export const TriggerInstallmentResponseSchema = z.object({ installment: InstallmentSchema, receivable: z.lazy(() => ReceivableSchema), created: z.boolean() }).openapi('TriggerInstallmentResponse');

export const CancelAgreementRequestSchema = z.object({}).openapi('CancelAgreementRequest');

// ---- MUT-100: contingency terms and outcomes ----------------------------------

export const ContingencyTermsPatchRequestSchema = z
  .object({ commissionRateBasisPoints: z.number().int().optional(), upfrontTreatment: UpfrontTreatmentSchema.optional() })
  .openapi('ContingencyTermsPatchRequest');

const outcomeFields = {
  outcome: ContingencyOutcomeSchema,
  /** AWARDED: required, > 0, in the agreement's pricing basis and currency. NO_RECOVERY: must be absent. */
  awardedAmount: AmountSchema.optional(),
  /** On or after the agreement date, not after today. The commission posts on this date at the VAT rate in force on it. */
  outcomeDate: IsoDateSchema,
  note: z.string().max(500).optional(),
  /** AWARDED: the commission line's label, localized by the caller (422 COMMISSION_LABEL_REQUIRED when missing). */
  commissionLabel: z.string().min(1).max(80).optional(),
  /** Overrides the commission's due date; default = the outcome date plus the agreement's payment terms. */
  dueDate: IsoDateSchema.optional(),
};
const correctionFields = {
  /** A correction may also fix the terms (R3/D5); outside a correction 409 OUTCOME_NOT_RECORDED. */
  commissionRateBasisPoints: z.number().int().optional(),
  upfrontTreatment: UpfrontTreatmentSchema.optional(),
};

export const ContingencyOutcomePreviewRequestSchema = z
  .object({ ...outcomeFields, ...correctionFields, correctionReason: z.string().min(1).max(500).optional() })
  .openapi('ContingencyOutcomePreviewRequest');

export const ContingencyOutcomeRequestSchema = z.object({ ...outcomeFields, previewToken: z.string().length(64) }).openapi('ContingencyOutcomeRequest');

export const ContingencyOutcomeCorrectRequestSchema = z
  .object({ ...outcomeFields, ...correctionFields, /** Becomes the reason on the replaced commission's credit; caller-localized. */ correctionReason: z.string().min(1).max(500), previewToken: z.string().length(64) })
  .openapi('ContingencyOutcomeCorrectRequest');

const billableSchema = z.object({ amount: AmountSchema, net: AmountSchema, vat: AmountSchema, gross: AmountSchema });

export const ContingencyOutcomePreviewSchema = z
  .object({
    /** RECORD before an outcome exists; CORRECT after (send the same body to /outcome/correct). */
    mode: z.enum(['RECORD', 'CORRECT']),
    outcome: ContingencyOutcomeSchema,
    awarded: AmountSchema.nullable(),
    outcomeDate: IsoDateSchema,
    commissionRateBasisPoints: z.number().int(),
    upfrontTreatment: UpfrontTreatmentSchema,
    /** Award × rate, half up. */
    commission: AmountSchema,
    /** Live upfront installments less the credits on them (stored splits), in the pricing basis. */
    upfrontCounted: AmountSchema,
    /** CREDITED: min(upfrontCounted, commission); SEPARATE: 0. */
    appliedUpfront: AmountSchema,
    /** What posts: commission − appliedUpfront, with VAT at the rate in force on the outcome date. All zero = nothing posts. */
    billable: billableSchema,
    vatRateBasisPoints: z.number().int(),
    postingDate: IsoDateSchema.nullable(),
    dueDate: IsoDateSchema.nullable(),
    /** CORRECT: the commission line being replaced (credited in full when it posted). */
    replaces: z.object({ installmentId: uuid, receivableId: uuid.nullable(), gross: AmountSchema }).nullable(),
    previewToken: z.string().length(64),
  })
  .openapi('ContingencyOutcomePreview');

export const ReceivableSchema = z
  .object({
    id: uuid,
    customerId: uuid,
    /** Null for an "Owed" capture with no matter (MUT-65); always set for INSTALLMENT/RETAINER_CHARGE. */
    projectId: uuid.nullable(),
    agreementId: uuid.nullable(),
    origin: z.enum(['INSTALLMENT', 'RETAINER_CHARGE', 'ADJUSTMENT']),
    originId: uuid.nullable(),
    currency: CurrencySchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    paid: AmountSchema,
    /** Σ credits (M4). outstanding = gross − paid − credited. */
    credited: AmountSchema,
    outstanding: AmountSchema,
    vatTreatment: VatTreatmentSchema,
    vatRateBasisPoints: z.number().int(),
    dueDate: IsoDateSchema,
    postingDate: IsoDateSchema,
    postedAt: z.string().datetime(),
    status: ItemStatusSchema,
    /** "What you did" (MUT-65, ADJUSTMENT origin only); null otherwise. */
    title: z.string().nullable(),
    /** MUT-373: who captured an Owed entry; only they may re-date it (PATCH /v1/income/{id}). Null for other origins. */
    capturedByUserId: uuid.nullable().openapi({ description: 'Who captured this Owed entry (ADJUSTMENT origin), so a client can offer re-dating only to them. Null for installments, retainer charges, and once that person\'s account is gone.' }),
    version: z.number().int(),
  })
  .openapi('Receivable');

export const ReceivablePageSchema = z.object({ items: z.array(ReceivableSchema), nextCursor: z.string().nullable() }).openapi('ReceivablePage');

export const ListReceivablesQuerySchema = z.object({
  ...pageQuery,
  customerId: uuid.optional(),
  projectId: uuid.optional(),
  currency: CurrencySchema.optional(),
  status: z.enum(['OPEN', 'SETTLED']).optional(),
  dueBefore: IsoDateSchema.optional(),
  dueAfter: IsoDateSchema.optional(),
});

export const RetainerPreviewRequestSchema = z
  .object({
    projectId: uuid,
    monthlyAmount: AmountSchema,
    currency: CurrencySchema.optional(),
    pricingBasis: PricingBasisSchema,
    vatTreatment: VatTreatmentSchema.optional(),
    startMonth: IsoMonthSchema,
    billingDay: z.number().int().min(1).max(MAX_BILLING_DAY).default(1),
    paymentTerms: PaymentTermsSchema.default('EOM'),
    endMonth: IsoMonthSchema.optional(),
    /** Defaults to today in the organization timezone; the VAT rate is resolved on it. */
    agreementDate: IsoDateSchema.optional(),
    description: z.string().max(500).optional(),
  })
  .openapi('RetainerPreviewRequest');

export const RetainerCreateRequestSchema = RetainerPreviewRequestSchema.extend({ previewToken: z.string().length(64) }).openapi('RetainerCreateRequest');

export const RetainerPreviewResponseSchema = z
  .object({
    monthly: z.object({ amount: AmountSchema, net: AmountSchema, vat: AmountSchema, gross: AmountSchema }),
    vatRateBasisPoints: z.number().int(),
    vatTreatment: VatTreatmentSchema,
    currency: CurrencySchema,
    /** Service months whose charge would post immediately on create (charge date ≤ today). */
    chargesDueNow: z.array(z.object({ serviceMonth: IsoMonthSchema, chargeDate: IsoDateSchema, dueDate: IsoDateSchema })),
    nextChargeDate: IsoDateSchema.nullable(),
    previewToken: z.string().length(64),
  })
  .openapi('RetainerPreviewResponse');

export const RetainerChargeSchema = z
  .object({
    id: uuid,
    /** The terms version the charge carries (M5); 1 = the original terms. */
    version: z.number().int(),
    serviceMonth: IsoMonthSchema,
    chargeDate: IsoDateSchema,
    amount: AmountSchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    vatTreatment: VatTreatmentSchema,
    rateBasisPoints: z.number().int(),
    receivableId: uuid,
    status: ItemStatusSchema,
    dueDate: IsoDateSchema,
    postedAt: z.string().datetime(),
  })
  .openapi('RetainerCharge');

export const RetainerTermsSchema = z
  .object({
    version: z.number().int(),
    effectiveMonth: IsoMonthSchema,
    monthlyAmount: AmountSchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    pricingBasis: PricingBasisSchema,
    vatTreatment: VatTreatmentSchema,
    rateBasisPoints: z.number().int(),
    billingDay: z.number().int(),
    paymentTerms: PaymentTermsSchema,
    endMonth: IsoMonthSchema.nullable(),
    reason: z.string().nullable(),
  })
  .openapi('RetainerTerms');

export const RetainerChargesResponseSchema = z
  .object({
    agreement: AgreementSchema,
    /** Every version of the terms in order; version 1 is the agreement's own terms (M5). */
    versions: z.array(RetainerTermsSchema),
    charges: z.array(RetainerChargeSchema),
  })
  .openapi('RetainerChargesResponse');

export const RetainerChangeRequestSchema = z
  .object({
    effectiveMonth: IsoMonthSchema,
    monthlyAmount: AmountSchema.optional(),
    pricingBasis: PricingBasisSchema.optional(),
    vatTreatment: VatTreatmentSchema.optional(),
    billingDay: z.number().int().min(1).max(MAX_BILLING_DAY).optional(),
    paymentTerms: PaymentTermsSchema.optional(),
    /** null clears the end month. */
    endMonth: IsoMonthSchema.nullable().optional(),
    reason: z.string().min(1).max(500),
  })
  .openapi('RetainerChangeRequest');

export const RetainerChangeApplyRequestSchema = RetainerChangeRequestSchema.extend({ previewToken: z.string().length(64) }).openapi('RetainerChangeApplyRequest');

export const RetainerChangePreviewResponseSchema = z
  .object({
    previous: RetainerTermsSchema,
    next: RetainerTermsSchema,
    effectiveMonth: IsoMonthSchema,
    changed: z.array(z.string()),
    /** The first service month that will be charged at the new terms, or null when every month from the effective month is already charged or the retainer ends before. */
    firstChargedMonth: IsoMonthSchema.nullable(),
    /** Generated months on or after the effective month: they keep their terms. */
    chargesKept: z.array(IsoMonthSchema),
    previewToken: z.string().length(64),
  })
  .openapi('RetainerChangePreviewResponse');

export const RetainerCancelRequestSchema = z
  .object({ effectiveDate: IsoDateSchema, finalMonth: FinalMonthSchema })
  .openapi('RetainerCancelRequest');

export const RetainerCancelApplyRequestSchema = RetainerCancelRequestSchema.extend({
  /** Required when the cancellation creates a credit (PRORATE, or WAIVE on an already-posted final month). */
  previewToken: z.string().length(64).optional(),
}).openapi('RetainerCancelApplyRequest');

export const RetainerCancelPreviewResponseSchema = z
  .object({
    effectiveMonth: IsoMonthSchema,
    finalMonth: FinalMonthSchema,
    finalCharge: z
      .object({ serviceMonth: IsoMonthSchema, days: z.number().int(), daysInMonth: z.number().int(), amount: AmountSchema, net: AmountSchema, vat: AmountSchema, gross: AmountSchema, posted: z.boolean() })
      .nullable(),
    postedCharge: z.object({ chargeId: uuid, receivableId: uuid, gross: AmountSchema, paid: AmountSchema, credited: AmountSchema, outstanding: AmountSchema }).nullable(),
    /** The credit the cancellation creates on the posted final month, or null. */
    adjustment: z.object({ amount: AmountSchema, net: AmountSchema, vat: AmountSchema, limitedByPayments: z.boolean() }).nullable(),
    /** The first month no longer charged, or null when nothing was still to come. */
    stoppedFrom: IsoMonthSchema.nullable(),
    /** The retainer's receivables still outstanding after the adjustment (sum within the retainer). */
    outstandingAfter: AmountSchema,
    previewToken: z.string().length(64),
  })
  .openapi('RetainerCancelPreviewResponse');

export const ReconcileResponseSchema = z
  .object({ installmentsPosted: z.number().int(), chargesCreated: z.number().int(), today: IsoDateSchema })
  .openapi('ReconcileResponse');


// ---- Milestone 4: payments, allocations, reversals, credits, operations ----

export const PaymentMethodSchema = z.enum(['CASH', 'BANK']).openapi('PaymentMethod');
export const PaymentStatusSchema = z.enum(['POSTED', 'REVERSED']).openapi('PaymentStatus');
/** Where a write came from (MUT-65). Audit metadata for most writes; persisted on an inbox entry (MUT-66) and on a captured payment (MUT-61). */
export const CaptureSourceSchema = z.enum(['app', 'siri', 'widget', 'quick_action', 'share']).openapi('CaptureSource');
/** MUT-66 persists this on an inbox entry, so the serializer needs the type, not just the schema. */
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;
/** MUT-61: who put a payment on the ledger — Malafat's integration, or a person capturing money they were handed. */
export const PaymentOriginSchema = z.enum(['integration', 'capture']).openapi('PaymentOrigin');
/** MUT-61: how much of a payment has been applied; a REVERSED payment reads `unallocated` (see status). */
export const AllocationStateSchema = z.enum(['unallocated', 'partial', 'allocated']).openapi('AllocationState');
export const AllocationStrategySchema = z.enum(['OLDEST_FIRST', 'SETTLE_MATTERS']).openapi('AllocationStrategy');

export const AllocationRequestSchema = z.object({ receivableId: uuid, amount: AmountSchema }).openapi('AllocationRequest');

const previewSource = {
  /** A new payment: who, which currency, how much. */
  customerId: uuid.optional(),
  currency: CurrencySchema.optional(),
  amount: AmountSchema.optional(),
  /** Or a posted payment whose unallocated funds are being allocated. */
  paymentId: uuid.optional(),
};

export const AllocationPreviewRequestSchema = z
  .object({
    ...previewSource,
    strategy: AllocationStrategySchema.optional(),
    /** Explicit set; wins over strategy. Absent with no strategy = everything unallocated. */
    allocations: z.array(AllocationRequestSchema).max(200).optional(),
  })
  .openapi('AllocationPreviewRequest');

export const BalanceSchema = z.object({ outstanding: AmountSchema, overdue: AmountSchema }).openapi('Balance');

export const EligibleReceivableSchema = z
  .object({ receivableId: uuid, projectId: uuid, agreementId: uuid.nullable(), origin: z.enum(['INSTALLMENT', 'RETAINER_CHARGE', 'ADJUSTMENT']), dueDate: IsoDateSchema, gross: AmountSchema, outstanding: AmountSchema, status: ItemStatusSchema })
  .openapi('EligibleReceivable');

export const AllocationPreviewResponseSchema = z
  .object({
    customerId: uuid,
    currency: CurrencySchema,
    /** The amount available: the new payment's amount or the payment's unallocated funds. */
    amount: AmountSchema,
    allocations: z.array(AllocationRequestSchema),
    allocated: AmountSchema,
    unallocated: AmountSchema,
    eligible: z.array(EligibleReceivableSchema),
    balances: z.object({
      receivables: z.array(z.object({ receivableId: uuid, projectId: uuid, outstandingBefore: AmountSchema, outstandingAfter: AmountSchema, statusBefore: ItemStatusSchema, statusAfter: ItemStatusSchema })),
      projects: z.array(z.object({ projectId: uuid, before: BalanceSchema, after: BalanceSchema })),
      customer: z.object({ before: BalanceSchema, after: BalanceSchema }),
    }),
    warnings: z.array(z.enum(['NO_ELIGIBLE_RECEIVABLES'])),
    previewToken: z.string().length(64),
  })
  .openapi('AllocationPreviewResponse');

export const CreatePaymentRequestSchema = z
  .object({
    customerId: uuid,
    currency: CurrencySchema,
    amount: AmountSchema,
    receivedOn: BoundedMoneyDateSchema,
    method: PaymentMethodSchema,
    reference: z.string().max(120).optional(),
    notes: z.string().max(2000).optional(),
    /** A REVERSED payment of the same customer this one corrects. */
    replacesPaymentId: uuid.optional(),
    allocations: z.array(AllocationRequestSchema).max(200),
    previewToken: z.string().length(64),
  })
  .openapi('CreatePaymentRequest');

export const AllocationSchema = z
  .object({ id: uuid, receivableId: uuid, projectId: uuid, origin: z.enum(['INSTALLMENT', 'RETAINER_CHARGE', 'ADJUSTMENT']), amount: AmountSchema, receivableOutstanding: AmountSchema, receivableStatus: ItemStatusSchema, createdAt: z.string().datetime() })
  .openapi('Allocation');

export const PaymentSchema = z
  .object({
    id: uuid,
    number: z.string(),
    /** Null for "Received" captured with no client (MUT-65). */
    customerId: uuid.nullable(),
    /** MUT-61: the matter picked when the payment was captured — a hint until it is allocated, after which its allocations say where it went. Null for payments Malafat recorded. */
    projectId: uuid.nullable().openapi({ description: 'The matter picked when a person captured this payment — a hint until it is allocated; after that its allocations say where the money went. Null for payments recorded through the API key.' }),
    /** MUT-61: `capture` for money a person recorded (the phone, the portal); filter on it with `allocationState` to find what still needs allocating. */
    origin: PaymentOriginSchema,
    /** MUT-61: the capture surface, when the client sent one; always null for `integration`. */
    captureSource: CaptureSourceSchema.nullable(),
    /** MUT-61: who captured it; null for `integration`, or once that person's account is gone. */
    capturedBy: z.object({ userId: uuid, displayName: z.string() }).nullable().openapi({ description: 'Who captured it: null for payments recorded through the API key, and once that person\'s account is gone.' }),
    currency: CurrencySchema,
    amount: AmountSchema,
    allocated: AmountSchema,
    unallocated: AmountSchema,
    /** MUT-61: from allocated vs amount. */
    allocationState: AllocationStateSchema,
    receivedOn: IsoDateSchema,
    method: PaymentMethodSchema,
    reference: z.string().nullable(),
    notes: z.string().nullable(),
    status: PaymentStatusSchema,
    reversedAt: z.string().datetime().nullable(),
    reversalReason: z.string().nullable(),
    replacesPaymentId: uuid.nullable(),
    replacedByPaymentId: uuid.nullable(),
    allocations: z.array(AllocationSchema),
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Payment');

export const PaymentPageSchema = z.object({ items: z.array(PaymentSchema), nextCursor: z.string().nullable() }).openapi('PaymentPage');

export const ListPaymentsQuerySchema = z.object({
  ...pageQuery,
  customerId: uuid.optional(),
  /** Payments with at least one allocation on the project, or captured against it and not allocated yet (MUT-61). */
  projectId: uuid.optional().openapi({ param: { description: 'Payments with an allocation on this project, or captured against it while they have no allocations at all (a captured matter is a hint until Malafat allocates).' } }),
  status: PaymentStatusSchema.optional(),
  receivedBefore: IsoDateSchema.optional(),
  receivedAfter: IsoDateSchema.optional(),
  /** MUT-61. */
  origin: PaymentOriginSchema.optional().openapi({ param: { description: '`capture`: money a person recorded (the phone, the portal); `integration`: recorded through this API key.' } }),
  /** MUT-61: POSTED payments only. `?origin=capture&allocationState=unallocated` is what the phone left for Malafat to allocate. */
  allocationState: AllocationStateSchema.optional().openapi({
    param: { description: 'Matches POSTED payments only (a REVERSED payment reads `unallocated` in the response but is never matched here). `?customerId=…&origin=capture&allocationState=unallocated` lists what a client\'s phone captures still need allocating; add `partial` for ones allocated in part.' },
  }),
});

export const PaymentIdParamSchema = z.object({ paymentId: uuid });

export const AllocatePaymentRequestSchema = z
  .object({ allocations: z.array(AllocationRequestSchema).min(1).max(200), previewToken: z.string().length(64) })
  .openapi('AllocatePaymentRequest');

export const ReversePaymentRequestSchema = z.object({ reason: z.string().min(1).max(500) }).openapi('ReversePaymentRequest');

export const CreditRequestSchema = z
  .object({
    /** Positive magnitude in the receivable's currency (gross). */
    amount: AmountSchema,
    reason: z.string().min(1).max(500),
    /** Defaults to today in the organization timezone. */
    effectiveDate: IsoDateSchema.optional(),
  })
  .openapi('CreditRequest');

export const CreditSchema = z
  .object({ id: uuid, receivableId: uuid, amount: AmountSchema, net: AmountSchema, vat: AmountSchema, reason: z.string(), effectiveDate: IsoDateSchema, createdAt: z.string().datetime() })
  .openapi('Credit');

export const CreditResponseSchema = z.object({ receivable: ReceivableSchema, credit: CreditSchema }).openapi('CreditResponse');
export const CreditsResponseSchema = z.object({ receivable: ReceivableSchema, credits: z.array(CreditSchema) }).openapi('CreditsResponse');

// ---- MUT-65: personal profile income capture (session-only) ----------------

export const IncomeKindSchema = z.enum(['received', 'owed']).openapi('IncomeKind');
/**
 * Received: unallocated / partial / allocated (how much of it is applied to receivables: Malafat's doing on a
 * Malafat-fed profile, a settle's on your own) or reversed. Owed: open / settled.
 * MUT-270 (D5) added partial, allocated and reversed: a fresh capture is still unallocated.
 */
export const IncomeStatusSchema = z.enum(['unallocated', 'partial', 'allocated', 'reversed', 'open', 'settled']).openapi('IncomeStatus');

const incomeText = z.string().trim().min(1).max(200);
const incomeNotes = z.string().max(2000);

export const CreateIncomeRequestSchema = z
  .object({
    kind: IncomeKindSchema,
    amount: AmountSchema,
    currency: CurrencySchema,
    occurredOn: PastMoneyDateSchema,
    /** Required for `owed`; optional for `received` ("money can stand alone"). */
    customerId: uuid.optional(),
    /** With no customerId, it is taken from the project. */
    projectId: uuid.optional(),
    /** `owed` only — "what you did". */
    title: incomeText.optional(),
    /** `received` only. */
    notes: incomeNotes.optional(),
    /** `owed` only; defaults to EOM_15 of occurredOn. */
    dueDate: IsoDateSchema.optional(),
    /** `received` only; defaults CASH. */
    method: PaymentMethodSchema.optional(),
    captureSource: CaptureSourceSchema.optional(),
  })
  .strict()
  .openapi('CreateIncomeRequest');

export const IncomeResponseSchema = z
  .object({
    id: uuid,
    kind: IncomeKindSchema,
    amount: AmountSchema,
    currency: CurrencySchema,
    occurredOn: IsoDateSchema,
    customerId: uuid.nullable(),
    projectId: uuid.nullable(),
    title: z.string().nullable(),
    notes: z.string().nullable(),
    /** `owed` only; null for `received`. */
    dueDate: IsoDateSchema.nullable(),
    status: IncomeStatusSchema,
    /** MUT-223: send it back in If-Match to PATCH /v1/income/{id}. */
    version: z.number().int().positive(),
  })
  .openapi('IncomeResponse');

export const IncomeIdParamSchema = z.object({ incomeId: uuid });

/** MUT-223: date only (amount, client, matter and note edits are out of scope). */
export const UpdateIncomeRequestSchema = z.object({ occurredOn: PastMoneyDateSchema }).strict().openapi('UpdateIncomeRequest');

/** MUT-223: date only; allocations are never touched. */
export const UpdatePaymentRequestSchema = z.object({ receivedOn: PastMoneyDateSchema }).strict().openapi('UpdatePaymentRequest');

export const SettleReceivableRequestSchema = z
  .object({
    /** Defaults to the full outstanding amount. */
    amount: AmountSchema.optional(),
    /** Defaults to today; rejected if later than today or more than ten years before it (MUT-227). */
    paidAt: PastMoneyDateSchema.optional(),
    method: PaymentMethodSchema.optional(),
    captureSource: CaptureSourceSchema.optional(),
  })
  .strict()
  .openapi('SettleReceivableRequest');

export const SettleReceivableResponseSchema = z.object({ receivable: ReceivableSchema, payment: PaymentSchema }).openapi('SettleReceivableResponse');

export const OperationKeyParamSchema = z.object({ idempotencyKey: z.string().min(8).max(128) });
export const OperationSchema = z
  .object({
    key: z.string(),
    operation: z.string(),
    status: z.enum(['PENDING', 'COMPLETED']),
    responseStatus: z.number().int().nullable(),
    /** The stored response body, exactly as the original request received it. */
    response: z.unknown().nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .openapi('Operation');

// ---- Milestone 6: summaries, audit listing, attachments --------------------------

export const CustomerSummaryStatusSchema = z.enum(['SETTLED', 'OVERDUE', 'OUTSTANDING', 'UP_TO_DATE']).openapi('CustomerSummaryStatus');
export const ProjectSummaryStatusSchema = z.enum(['NONE', 'PENDING', 'OUTSTANDING', 'PARTIALLY_PAID', 'OVERDUE', 'PAID_IN_FULL', 'UP_TO_DATE', 'CANCELLED', 'SETTLED']).openapi('ProjectSummaryStatus');

const bucketFields = { outstanding: AmountSchema, overdue: AmountSchema, dueToday: AmountSchema, notYetDue: AmountSchema };

/** M8 (D17): a customer's open (PROPOSED) fee proposal as the overview lists it, in the block's currency. MUT-107: `amount` is the upfront for a contingency proposal; `contingency` echoes its terms. */
export const CustomerSummaryProposalSchema = z
  .object({ proposalId: uuid, projectId: uuid, amount: AmountSchema, proposedOn: IsoDateSchema, contingency: ContingencyTermsSchema.nullable() })
  .openapi('CustomerSummaryProposal');

export const CustomerSummaryRowSchema = z
  .object({ customerId: uuid, ...bucketFields, unallocated: AmountSchema, lastPaymentOn: IsoDateSchema.nullable(), status: CustomerSummaryStatusSchema, proposals: z.array(CustomerSummaryProposalSchema) })
  .openapi('CustomerSummaryRow');

export const CurrencySummarySchema = z
  .object({
    currency: CurrencySchema,
    ...bucketFields,
    unallocated: AmountSchema,
    /** M8: the sum of the block's open (PROPOSED) fee proposals, in the pricing basis. */
    proposed: AmountSchema,
    counts: z.object({ customers: z.number().int(), overdueCustomers: z.number().int(), unallocatedPayments: z.number().int(), openProposals: z.number().int() }),
    customers: z.array(CustomerSummaryRowSchema),
  })
  .openapi('CurrencySummary');

export const OrganizationSummarySchema = z.object({ asOf: IsoDateSchema, currencies: z.array(CurrencySummarySchema) }).openapi('OrganizationSummary');

// ---- Milestone 7: fee proposals ---------------------------------------------

export const FEE_PROPOSAL_STATUSES = ['PROPOSED', 'APPROVED', 'WITHDRAWN'] as const;
export const FeeProposalStatusSchema = z.enum(FEE_PROPOSAL_STATUSES).openapi('FeeProposalStatus');

const proposalNote = z.string().max(2000);

export const FeeProposalSchema = z
  .object({
    id: uuid,
    projectId: uuid,
    customerId: uuid,
    currency: CurrencySchema,
    status: FeeProposalStatusSchema,
    pricingBasis: PricingBasisSchema,
    /** The amount proposed to the client, in the pricing basis. */
    proposedAmount: AmountSchema,
    proposedOn: IsoDateSchema,
    note: z.string().nullable(),
    /** The approval date; the agreement is dated the same. */
    clientApprovedOn: IsoDateSchema.nullable(),
    clientApprovalNote: z.string().nullable(),
    /** Null while PROPOSED or WITHDRAWN; the final amount once APPROVED. */
    agreedAmount: AmountSchema.nullable(),
    withdrawnAt: z.string().datetime().nullable(),
    withdrawnReason: z.string().nullable(),
    /** The agreement the approval created (APPROVED). */
    agreementId: uuid.nullable(),
    /** MUT-107: the proposed terms when this is a contingency proposal; null for FIXED. */
    contingency: ContingencyTermsSchema.nullable(),
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('FeeProposal');

/** The proposal block on a project summary: the open one, else the latest approved one. */
export const FeeProposalSummarySchema = z
  .object({ id: uuid, status: FeeProposalStatusSchema, pricingBasis: PricingBasisSchema, proposedAmount: AmountSchema, agreedAmount: AmountSchema.nullable(), proposedOn: IsoDateSchema, agreementId: uuid.nullable(), contingency: ContingencyTermsSchema.nullable() })
  .openapi('FeeProposalSummary');

export const CreateFeeProposalRequestSchema = z
  .object({
    projectId: uuid,
    /** In the pricing basis, project currency. With `contingency`: the proposed upfront, which may be 0. */
    amount: AmountSchema,
    pricingBasis: PricingBasisSchema,
    /** Defaults to today in the organization timezone. */
    proposedOn: IsoDateSchema.optional(),
    note: proposalNote.optional(),
    /** MUT-107: present = a contingency proposal (amount is the upfront); absent = FIXED. */
    contingency: ContingencyTermsSchema.optional(),
  })
  .openapi('CreateFeeProposalRequest');

/** M8 (D5, D15 B): how the approved fee is to be paid. ONCE → one installment posted at once, due on `dueOn`; INSTALLMENTS → equal monthly shares (remainder on the first), the first posted at once and due on `firstDueOn`, the rest posted on their dates. */
export const ApproveScheduleSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('ONCE'), dueOn: IsoDateSchema }),
    z.object({ kind: z.literal('INSTALLMENTS'), count: z.number().int().min(2).max(MAX_INSTALLMENTS), firstDueOn: IsoDateSchema }),
  ])
  .openapi('ApproveSchedule');

export const ApproveFeeProposalRequestSchema = z
  .object({
    /** The final amount, in the pricing basis and project currency; prefilled with the proposed one by clients. The agreed upfront for a contingency proposal, which may be 0. */
    amount: AmountSchema,
    /** Defaults to today in the organization timezone; the agreement is dated the same, so the VAT rate in force on it applies (D18). */
    approvedOn: IsoDateSchema.optional(),
    /** MUT-107 (D10): required only when the agreed amount is greater than 0; omitting it otherwise is 422 SCHEDULE_REQUIRED. */
    schedule: ApproveScheduleSchema.optional(),
    note: proposalNote.optional(),
    /** MUT-107: overrides the proposed contingency terms for the created agreement; only valid when the proposal itself is a contingency one (422 NOT_CONTINGENCY otherwise). */
    contingency: ContingencyTermsSchema.optional(),
  })
  .openapi('ApproveFeeProposalRequest');
export const WithdrawFeeProposalRequestSchema = z.object({ reason: proposalNote.optional() }).openapi('WithdrawFeeProposalRequest');

export const ListFeeProposalsQuerySchema = z.object({
  ...pageQuery,
  projectId: uuid.optional(),
  customerId: uuid.optional(),
  status: FeeProposalStatusSchema.optional(),
  open: z.enum(['true', 'false']).optional().openapi({ description: '`true` narrows to PROPOSED; `false` to APPROVED | WITHDRAWN.' }),
});
export const FeeProposalPageSchema = z.object({ items: z.array(FeeProposalSchema), nextCursor: z.string().nullable() }).openapi('FeeProposalPage');
/** M8: approving returns the proposal and the agreement it created, with its installments (the first already posted). */
export const ApproveFeeProposalResponseSchema = z.object({ proposal: FeeProposalSchema, agreement: AgreementDetailSchema }).openapi('ApproveFeeProposalResponse');
export const FeeProposalIdParamSchema = z.object({ proposalId: uuid });

export const ProjectSummarySchema = z
  .object({
    projectId: uuid,
    currency: CurrencySchema,
    kind: z.enum(['FIXED', 'RETAINER', 'NONE']),
    /** Fixed: the active agreement's gross total. */
    agreed: AmountSchema.nullable(),
    /** Retainer: the monthly gross of the terms in force. */
    monthly: AmountSchema.nullable(),
    posted: AmountSchema,
    paid: AmountSchema,
    credited: AmountSchema,
    ...bucketFields,
    pending: z.object({ count: z.number().int(), amount: AmountSchema }),
    status: ProjectSummaryStatusSchema,
    /** M7: the open fee proposal, else the latest approved one, else null. */
    proposal: FeeProposalSummarySchema.nullable(),
    /** MUT-100: the project's ACTIVE contingency agreement (the latest, if several), else null. It counts in `agreed`; `kind` stays FIXED. */
    contingency: z
      .object({ agreementId: uuid, commissionRateBasisPoints: z.number().int(), upfrontTreatment: UpfrontTreatmentSchema, outcome: z.enum(['AWAITING', ...CONTINGENCY_OUTCOMES]), awarded: AmountSchema.nullable() })
      .nullable()
      .openapi('ProjectContingency'),
  })
  .openapi('ProjectSummary');

export const CustomerCurrencySummarySchema = z
  .object({ currency: CurrencySchema, ...bucketFields, unallocated: AmountSchema, status: CustomerSummaryStatusSchema, projects: z.array(ProjectSummarySchema) })
  .openapi('CustomerCurrencySummary');

export const CustomerSummarySchema = z
  .object({ customerId: uuid, asOf: IsoDateSchema, lastPaymentOn: IsoDateSchema.nullable(), currencies: z.array(CustomerCurrencySummarySchema) })
  .openapi('CustomerSummary');

export const ProjectSummaryResponseSchema = ProjectSummarySchema.extend({ asOf: IsoDateSchema }).openapi('ProjectSummaryResponse');

export const SummaryCurrencyQuerySchema = z.object({ currency: CurrencySchema.optional() });

export const ListAuditQuerySchema = z.object({
  ...pageQuery,
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(128).optional(),
  action: z.string().min(1).max(64).optional(),
});
export const AuditPageSchema = z.object({ items: z.array(AuditEventSchema), nextCursor: z.string().nullable() }).openapi('AuditPage');

export const AttachmentKindSchema = z.enum(['INVOICE', 'RECEIPT', 'OTHER']).openapi('AttachmentKind');
export const AttachmentStatusSchema = z.enum(['PENDING_UPLOAD', 'READY']).openapi('AttachmentStatus');
export const AttachmentMimeTypeSchema = z.enum(['application/pdf', 'image/jpeg', 'image/png']).openapi('AttachmentMimeType');

export const AttachmentSchema = z
  .object({
    id: uuid,
    kind: AttachmentKindSchema,
    filename: z.string(),
    mimeType: AttachmentMimeTypeSchema,
    sizeBytes: z.number().int(),
    status: AttachmentStatusSchema,
    customerId: uuid.nullable(),
    projectId: uuid.nullable(),
    paymentId: uuid.nullable(),
    invoiceNumber: z.string().nullable(),
    invoiceDate: IsoDateSchema.nullable(),
    uploadedByKeyId: z.string().nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .openapi('Attachment');

export const CreateUploadRequestSchema = z
  .object({
    kind: AttachmentKindSchema,
    filename: z.string().min(1).max(200),
    mimeType: AttachmentMimeTypeSchema,
    sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
    customerId: uuid.optional(),
    projectId: uuid.optional(),
    paymentId: uuid.optional(),
    invoiceNumber: z.string().max(80).optional(),
    invoiceDate: IsoDateSchema.optional(),
  })
  .openapi('CreateUploadRequest');

export const CreateUploadResponseSchema = z
  .object({
    attachment: AttachmentSchema,
    upload: z.object({ url: z.string().url(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expiresAt: z.string().datetime() }),
  })
  .openapi('CreateUploadResponse');

export const AttachmentDownloadSchema = z.object({ url: z.string().url(), expiresAt: z.string().datetime(), filename: z.string(), mimeType: AttachmentMimeTypeSchema }).openapi('AttachmentDownload');

export const ListAttachmentsQuerySchema = z.object({
  ...pageQuery,
  customerId: uuid.optional(),
  projectId: uuid.optional(),
  paymentId: uuid.optional(),
  kind: AttachmentKindSchema.optional(),
});
export const AttachmentPageSchema = z.object({ items: z.array(AttachmentSchema), nextCursor: z.string().nullable() }).openapi('AttachmentPage');
export const AttachmentIdParamSchema = z.object({ attachmentId: uuid.openapi({ param: { name: 'attachmentId', in: 'path' } }) });

// ---- MUT-42: expenses on hosted profiles (session-only) ----------------------

const expenseText = z.string().trim().min(1).max(200);
const expenseNotes = z.string().max(4000);
const categoryName = z.string().trim().min(1).max(60);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '#rrggbb');

export const ExpenseSchema = z
  .object({
    id: uuid,
    occurredOn: IsoDateSchema,
    /** The original amount, in `currency`; never converted. */
    amount: AmountSchema,
    currency: CurrencySchema,
    title: z.string().nullable(),
    vendor: z.string().nullable(),
    categoryId: uuid.nullable(),
    /** The client this expense is for, if any. Null = the firm's own (or, on a personal profile, personal) spending. */
    customerId: uuid.nullable(),
    projectId: uuid.nullable(),
    notes: z.string().nullable(),
    createdByUserId: uuid,
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Expense');

export const ExpenseReceiptSchema = z
  .object({
    id: uuid,
    expenseId: uuid,
    filename: z.string(),
    mimeType: AttachmentMimeTypeSchema,
    sizeBytes: z.number().int(),
    status: AttachmentStatusSchema,
    uploadedByUserId: uuid,
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .openapi('ExpenseReceipt');

export const ExpenseDetailSchema = ExpenseSchema.extend({ receipts: z.array(ExpenseReceiptSchema) }).openapi('ExpenseDetail');
export const ExpensePageSchema = z.object({ items: z.array(ExpenseSchema), nextCursor: z.string().nullable() }).openapi('ExpensePage');

export const CreateExpenseRequestSchema = z
  .object({
    occurredOn: FlooredMoneyDateSchema,
    amount: AmountSchema.openapi({ description: 'Greater than zero, in the currency\'s fractional digits' }),
    currency: CurrencySchema,
    title: expenseText.optional(),
    vendor: expenseText.optional(),
    categoryId: uuid.optional(),
    customerId: uuid.optional(),
    projectId: uuid.optional().openapi({ description: 'With projectId alone, customerId is the project\'s customer' }),
    notes: expenseNotes.optional(),
    /** MUT-65: where the write came from; audit metadata only, never persisted on the row. */
    captureSource: CaptureSourceSchema.optional(),
  })
  .strict()
  .openapi('CreateExpenseRequest');

/** MUT-272: `currency` only together with `amount` (ADR-096); the amount is never converted, only re-read in the new currency's digits. Null clears an optional field. */
export const UpdateExpenseRequestSchema = z
  .object({
    occurredOn: FlooredMoneyDatePatchSchema.optional(),
    amount: AmountSchema.optional(),
    /** MUT-272: only together with `amount` (422 AMOUNT_REQUIRED alone), which is then read in this currency's digits. */
    currency: CurrencySchema.optional().openapi({ description: 'Only together with amount (422 AMOUNT_REQUIRED alone), which is then read in this currency\'s digits.' }),
    title: expenseText.nullable().optional(),
    vendor: expenseText.nullable().optional(),
    categoryId: uuid.nullable().optional(),
    customerId: uuid.nullable().optional(),
    projectId: uuid.nullable().optional(),
    notes: expenseNotes.nullable().optional(),
  })
  .strict()
  .openapi('UpdateExpenseRequest');

export const ListExpensesQuerySchema = z.object({
  ...pageQuery,
  anchor: uuid.optional().openapi({ description: 'Start the page at this expense, inclusive (MUT-91). Filters still apply. Not with `cursor`.' }),
  from: IsoDateSchema.optional().openapi({ description: 'Inclusive' }),
  to: IsoDateSchema.optional().openapi({ description: 'Inclusive' }),
  currency: CurrencySchema.optional(),
  categoryId: uuid.optional(),
  customerId: uuid.optional(),
  projectId: uuid.optional(),
  linked: z.enum(['none']).optional().openapi({ description: '`none`: only expenses linked to no client' }),
  groupId: uuid.optional().openapi({ description: 'MUT-267: only this group\'s members (or, with groupMembership=excluded, its left-out expenses dated inside its window). 404 for a group this profile does not have.' }),
  groupMembership: z.enum(['member', 'excluded']).optional().openapi({ description: 'Requires groupId (422 GROUP_ID_REQUIRED without it). Default `member`.' }),
});

export const ExpenseIdParamSchema = z.object({ expenseId: uuid });
export const ExpenseReceiptParamSchema = z.object({ expenseId: uuid, receiptId: uuid });

const conversionNotes = z.string().max(4000);

/** MUT-161: a logged currency conversion. MUT-194 (ADR-075): versioned like Expense, edited with If-Match. */
export const ConversionSchema = z
  .object({
    id: uuid,
    occurredOn: IsoDateSchema,
    /** The source leg. */
    amount: AmountSchema,
    currency: CurrencySchema,
    /** The destination leg. Never equal to `currency`. */
    toAmount: AmountSchema,
    toCurrency: CurrencySchema,
    notes: z.string().nullable(),
    createdByUserId: uuid,
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Conversion');

export const ConversionPageSchema = z.object({ items: z.array(ConversionSchema), nextCursor: z.string().nullable() }).openapi('ConversionPage');

export const CreateConversionRequestSchema = z
  .object({
    occurredOn: PastMoneyDateSchema,
    amount: AmountSchema.openapi({ description: 'Greater than zero, in the currency\'s fractional digits' }),
    currency: CurrencySchema,
    toAmount: AmountSchema.openapi({ description: 'Greater than zero, in toCurrency\'s fractional digits' }),
    toCurrency: CurrencySchema,
    notes: conversionNotes.optional(),
  })
  .strict()
  .openapi('CreateConversionRequest');

/**
 * MUT-194: every field optional; null clears the notes. A currency must come with its own amount
 * (422 AMOUNT_REQUIRED): a leg's fractional digits follow its currency, so a currency alone would rescale it.
 */
export const UpdateConversionRequestSchema = z
  .object({
    occurredOn: PastMoneyDatePatchSchema.optional(),
    amount: AmountSchema.optional().openapi({ description: 'In the merged currency\'s fractional digits (the body\'s `currency`, else the row\'s)' }),
    currency: CurrencySchema.optional().openapi({ description: 'Only together with `amount`' }),
    toAmount: AmountSchema.optional().openapi({ description: 'In the merged toCurrency\'s fractional digits' }),
    toCurrency: CurrencySchema.optional().openapi({ description: 'Only together with `toAmount`; must differ from the merged `currency`' }),
    notes: conversionNotes.nullable().optional(),
  })
  .strict()
  .openapi('UpdateConversionRequest');

export const ListConversionsQuerySchema = z.object({
  ...pageQuery,
  anchor: uuid.optional().openapi({ description: 'Start the page at this conversion, inclusive (MUT-91). Filters still apply. Not with `cursor`.' }),
  from: IsoDateSchema.optional().openapi({ description: 'Inclusive' }),
  to: IsoDateSchema.optional().openapi({ description: 'Inclusive' }),
  currency: CurrencySchema.optional().openapi({ description: 'Matches either leg' }),
});

export const ConversionIdParamSchema = z.object({ conversionId: uuid });

export const CreateReceiptUploadRequestSchema = z
  .object({ filename: z.string().min(1).max(200), mimeType: AttachmentMimeTypeSchema, sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024) })
  .strict()
  .openapi('CreateReceiptUploadRequest');

export const CreateReceiptUploadResponseSchema = z
  .object({
    receipt: ExpenseReceiptSchema,
    upload: z.object({ url: z.string().url(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expiresAt: z.string().datetime() }),
  })
  .openapi('CreateReceiptUploadResponse');

export const ExpenseCategorySchema = z
  .object({ id: uuid, name: z.string(), color: z.string().nullable(), archived: z.boolean(), version: z.number().int(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })
  .openapi('ExpenseCategory');
export const ExpenseCategoryListSchema = z.object({ items: z.array(ExpenseCategorySchema) }).openapi('ExpenseCategoryList');
export const ListExpenseCategoriesQuerySchema = z.object({ includeArchived: z.enum(['true', 'false']).optional() });
export const ExpenseCategoryIdParamSchema = z.object({ categoryId: uuid });
export const CreateExpenseCategoryRequestSchema = z.object({ name: categoryName, color: hexColor.optional() }).strict().openapi('CreateExpenseCategoryRequest');
export const UpdateExpenseCategoryRequestSchema = z
  .object({ name: categoryName.optional(), color: hexColor.nullable().optional(), archived: z.boolean().optional() })
  .strict()
  .openapi('UpdateExpenseCategoryRequest');

const expenseBucket = { total: AmountSchema, count: z.number().int() };
export const ExpenseSummaryQuerySchema = z.object({
  from: IsoDateSchema.optional().openapi({ description: 'Inclusive; defaults to the first of this month in the organization timezone' }),
  to: IsoDateSchema.optional().openapi({ description: 'Inclusive; defaults to the last of this month' }),
});
export const ExpenseSummarySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    currencies: z.array(
      z.object({
        currency: CurrencySchema,
        ...expenseBucket,
        byCategory: z.array(z.object({ categoryId: uuid.nullable(), ...expenseBucket })),
        byCustomer: z.array(z.object({ customerId: uuid.nullable(), ...expenseBucket })),
      }),
    ),
  })
  .openapi('ExpenseSummary');

// ---- MUT-267: expense groups (ADR-094) -----------------------------------------

const groupName = z.string().trim().max(GROUP_NAME_MAX);
const groupNotes = z.string().max(4000);
const groupDate = IsoDateSchema.openapi({ description: `Calendar date in the organization timezone, YYYY-MM-DD. Not more than ten years (${DAYS_IN_PAST_LIMIT} days) before the organization's today nor ten years (${DAYS_IN_FUTURE_LIMIT} days) after it: 422 DATE_INVALID with details.bound past or future.` });
const currencyTotal = z.object({ currency: CurrencySchema, ...expenseBucket });

export const ExpenseGroupSchema = z
  .object({
    id: uuid,
    name: z.string(),
    startOn: IsoDateSchema,
    /** Null = still going. */
    endOn: IsoDateSchema.nullable(),
    /** The last day the group collects: endOn, or a year after startOn while still going (R6). */
    windowEnd: IsoDateSchema,
    notes: z.string().nullable(),
    /** Members per currency, never summed across currencies (ADR-004). */
    currencies: z.array(currencyTotal),
    memberCount: z.number().int(),
    createdByUserId: uuid,
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ExpenseGroup');

export const ExpenseGroupDetailSchema = ExpenseGroupSchema.extend({
  /** Left-out expenses dated inside the window (design review 22A). */
  excludedCount: z.number().int(),
}).openapi('ExpenseGroupDetail');

export const ExpenseGroupListSchema = z.object({ items: z.array(ExpenseGroupSchema) }).openapi('ExpenseGroupList');

export const ListExpenseGroupsQuerySchema = z.object({
  expenseId: uuid.optional().openapi({ description: 'Only the groups this expense belongs to (dated in the window and not left out, or kept)' }),
});

export const CreateExpenseGroupRequestSchema = z
  .object({
    name: groupName.openapi({ description: `Trimmed; 1–${GROUP_NAME_MAX} characters (422 NAME_REQUIRED when blank)` }),
    startOn: groupDate,
    endOn: groupDate.optional().openapi({ description: `Absent = still going. Not before startOn (END_BEFORE_START); at most ${MAX_GROUP_SPAN_DAYS} days including both ends (GROUP_RANGE_TOO_LONG)` }),
    notes: groupNotes.optional(),
  })
  .strict()
  .openapi('CreateExpenseGroupRequest');

export const UpdateExpenseGroupRequestSchema = z
  .object({
    name: groupName.optional(),
    startOn: groupDate.optional(),
    endOn: groupDate.nullable().optional().openapi({ description: 'null = still going. The merged range is checked' }),
    notes: groupNotes.nullable().optional(),
  })
  .strict()
  .openapi('UpdateExpenseGroupRequest');

export const ExpenseGroupIdParamSchema = z.object({ groupId: uuid });
export const ExpenseGroupExpenseParamSchema = z.object({ groupId: uuid, expenseId: uuid });

export const ExpenseGroupOverrideModeSchema = z.enum(['excluded', 'included']).openapi('ExpenseGroupOverrideMode');
export const SetExpenseGroupOverrideRequestSchema = z.object({ mode: ExpenseGroupOverrideModeSchema }).strict().openapi('SetExpenseGroupOverrideRequest');
export const ExpenseGroupOverrideSchema = z
  .object({ groupId: uuid, expenseId: uuid, mode: ExpenseGroupOverrideModeSchema, updatedAt: z.string().datetime() })
  .openapi('ExpenseGroupOverride');

export const ExpenseGroupSummarySchema = z
  .object({
    groupId: uuid,
    /** The zero-filled days (C2): a closed group's range, or an open group's start up to today, within its window. */
    seriesFrom: IsoDateSchema,
    seriesTo: IsoDateSchema,
    currencies: z.array(
      z.object({
        currency: CurrencySchema,
        ...expenseBucket,
        byCategory: z.array(z.object({ categoryId: uuid.nullable(), ...expenseBucket })),
        byCustomer: z.array(z.object({ customerId: uuid.nullable(), ...expenseBucket })),
        /** Every series day, plus a sparse bucket for each member dated outside it, so the buckets sum to the total (6A). */
        byDay: z.array(z.object({ date: IsoDateSchema, position: z.enum(['before', 'in', 'after']), ...expenseBucket })),
      }),
    ),
  })
  .openapi('ExpenseGroupSummary');

// ---- MUT-66: the unsorted inbox ---------------------------------------------

export const InboxEntryKindSchema = z.enum(['income', 'expense']).openapi('InboxEntryKind');

const inboxNote = z.string().max(2000);

export const InboxEntrySchema = z
  .object({
    id: uuid,
    kind: InboxEntryKindSchema,
    /** The original amount, in `currency`; never converted, here or in the record it becomes. */
    amount: AmountSchema,
    currency: CurrencySchema,
    occurredOn: IsoDateSchema,
    note: z.string().nullable(),
    /** Persisted here, unlike on an expense or income write: an entry can sit unfiled, and still shows how it arrived. */
    captureSource: CaptureSourceSchema.nullable(),
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('InboxEntry');

export const InboxEntryPageSchema = z.object({ items: z.array(InboxEntrySchema), nextCursor: z.string().nullable() }).openapi('InboxEntryPage');

/** MUT-240: the Capture hub's Recent handle needs an exact count, not a full page. */
export const InboxCountSchema = z.object({ count: z.number().int().nonnegative() }).openapi('InboxCount');

export const CreateInboxEntryRequestSchema = z
  .object({
    kind: InboxEntryKindSchema,
    amount: AmountSchema.openapi({ description: 'Greater than zero, in the currency\'s fractional digits' }),
    currency: CurrencySchema,
    occurredOn: IsoDateSchema.openapi({ description: `May be in the future: an unsorted entry has no profile, so no timezone to judge "today" in. Filing applies that check. Not more than ten years (${DAYS_IN_PAST_LIMIT} days) before UTC yesterday (MUT-227): 422 DATE_INVALID with details.bound past; filing applies the exact floor in the profile's timezone.` }),
    note: inboxNote.optional(),
    captureSource: CaptureSourceSchema.optional(),
  })
  .strict()
  .openapi('CreateInboxEntryRequest');

/** No `kind`: what an entry is destined to become is fixed at capture. A changed currency comes with its amount. Null clears an optional field. */
export const UpdateInboxEntryRequestSchema = z
  .object({
    amount: AmountSchema.optional(),
    currency: CurrencySchema.optional(),
    occurredOn: IsoDateSchema.optional().openapi({ description: `Not more than ten years (${DAYS_IN_PAST_LIMIT} days) before UTC yesterday (MUT-227): 422 DATE_INVALID with details.bound past.${UNCHANGED_NOT_CHECKED}` }),
    note: inboxNote.nullable().optional(),
    captureSource: CaptureSourceSchema.nullable().optional(),
  })
  .strict()
  .openapi('UpdateInboxEntryRequest');

export const ListInboxQuerySchema = z.object({ ...pageQuery });

export const InboxEntryIdParamSchema = z.object({ entryId: uuid });

/** Amount, currency, date and note come from the entry itself; only what the entry could not know is supplied here. */
export const FileAsExpenseRequestSchema = z
  .object({
    categoryId: uuid.optional(),
    vendor: expenseText.optional(),
    title: expenseText.optional(),
    customerId: uuid.optional(),
    projectId: uuid.optional().openapi({ description: 'With projectId alone, customerId is the project\'s customer' }),
  })
  .strict()
  .openapi('FileAsExpenseRequest');

/** The Received/Owed choice is made here, not at capture: it only means something once a client is (or deliberately is not) in the picture. */
export const FileAsIncomeRequestSchema = z
  .object({
    kind: IncomeKindSchema,
    /** Required for `owed`; optional for `received`. */
    customerId: uuid.optional(),
    projectId: uuid.optional(),
    /** `owed` only. */
    title: incomeText.optional(),
    /** `owed` only; defaults to EOM_15 of the entry's occurredOn. */
    dueDate: IsoDateSchema.optional(),
    /** `received` only; defaults CASH. */
    method: PaymentMethodSchema.optional(),
  })
  .strict()
  .openapi('FileAsIncomeRequest');

// ---- MUT-270: the entries feed (session-only, no profile header) ------------

/** A repeated query parameter arrives as an array, a single one as a string: always an array here. */
const repeatable = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(item).optional());

export const ListEntriesQuerySchema = z.object({
  profileId: repeatable(z.string()).openapi({
    description: 'Repeatable. Only these profiles; every profile you belong to when absent. One you do not belong to (or not an id at all) answers 404.',
    param: { style: 'form', explode: true },
  }),
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ description: 'Page size, 1–100.' }),
  cursor: z.string().optional().openapi({ description: 'Opaque `nextCursor` from the previous page.' }),
});

/** What every feed item says about itself, whatever it is. */
const entryEnvelope = {
  /** The profile (organization) the entry is on. */
  profileId: uuid,
  /** When it was logged — the feed's order, newest first. Not the money date (`occurredOn`). */
  createdAt: z.string().datetime(),
};

export const EntrySchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('expense'),
      ...entryEnvelope,
      createdByUserId: uuid,
      expense: ExpenseSchema.and(z.object({ receiptCount: z.number().int().nonnegative().openapi({ description: 'READY receipts attached' }) })),
    }),
    z.object({
      kind: z.literal('received'),
      ...entryEnvelope,
      /** Null for a payment Malafat recorded: no person logged it. */
      createdByUserId: uuid.nullable(),
      /** capture: a person recorded it (POST /v1/income, inbox filing or a settle); integration: Malafat did. */
      origin: z.enum(['capture', 'integration']),
      /** The one Owed entry this payment paid toward (a settle, full or partial), or null. The Owed reads `settled` once paid in full, `open` before. */
      settlesOwedId: uuid.nullable(),
      /** The payment Malafat reversed and replaced with this one, or null. The replaced one reads `reversed`. */
      replacesPaymentId: uuid.nullable(),
      income: IncomeResponseSchema,
    }),
    z.object({
      kind: z.literal('owed'),
      ...entryEnvelope,
      createdByUserId: uuid.nullable(),
      income: IncomeResponseSchema,
    }),
    z.object({
      kind: z.literal('conversion'),
      ...entryEnvelope,
      createdByUserId: uuid,
      conversion: ConversionSchema,
    }),
  ])
  .openapi('Entry');

export const EntryPageSchema = z.object({ items: z.array(EntrySchema), nextCursor: z.string().nullable() }).openapi('EntryPage');
