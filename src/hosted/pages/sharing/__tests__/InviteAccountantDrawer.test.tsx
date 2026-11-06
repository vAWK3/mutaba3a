import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AccountantGrant, BillingEntitlement, Me } from '../../../api/client';
import { ORG_B, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';

/** Review fix (d): a person's text inside a sentence is isolated (FSI … PDI). */
const iso = (text: string) => `\u2068${text}\u2069`;

/**
 * MUT-561: the invite drawer (B2, Basel 13244: the side drawer). It sends `{ email, locale }` in the portal's language
 * (OW2, no picker), shows every refusal in its slot, stays busy while sending, and turns read-only under the lapse gate.
 */

const studio = profile({ id: ORG_B, name: 'Studio', owned: true, type: 'BUSINESS', isPersonalDefault: false, writerOfRecord: null, owners: [] });
const account = (overrides: Partial<Me> = {}): Me => ({ ...me([studio]), clients: [], ...overrides });

const pending = (email: string): AccountantGrant => ({
  id: 'g-new',
  email,
  name: null,
  status: 'pending',
  invitedAt: '2026-11-06T09:00:00.000Z',
  expiresAt: '2026-11-20T09:00:00.000Z',
  acceptedAt: null,
  lastViewedAt: null,
});

function portal(invite: Handler, who: Me = account(), language: 'en' | 'ar' = 'en') {
  const items: AccountantGrant[] = [];
  const stub = stubApi({
    ...emptyProfileRoutes(),
    'GET /v1/me': () => ok({ ...who, user: { ...who.user, locale: language } }),
    [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok({ items, limit: 5 }),
    // As the server: a 201 adds the pending invite to the list
    [`POST /v1/profiles/${ORG_B}/accountants`]: async (request) => {
      const answer = await invite(request);
      if (answer.status === 201) items.push((await answer.clone().json()) as AccountantGrant);
      return answer;
    },
  });
  return { ...renderPortal(`/p/${ORG_B}/you/sharing?invite=true`), stub };
}

async function send(user: ReturnType<typeof renderPortal>['user'], email: string) {
  const dialog = await screen.findByRole('dialog', { name: 'Invite an accountant' });
  const field = within(dialog).getByLabelText('Email');
  await user.clear(field);
  await user.type(field, email);
  await user.click(screen.getByRole('button', { name: 'Send invite' }));
  return dialog;
}

afterEach(() => vi.unstubAllGlobals());

describe('InviteAccountantDrawer (MUT-561)', () => {
  it('opens by its URL key with the intro and the four scope points', async () => {
    portal(() => ok(pending('x@y.co'), 201));
    const dialog = await screen.findByRole('dialog', { name: 'Invite an accountant' });
    expect(within(dialog).getByText("They'll get an email to accept. It ends after 14 days.")).toBeInTheDocument();
    expect(within(within(dialog).getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
    expect(within(dialog).getByLabelText('Email')).toHaveAttribute('dir', 'ltr');
  });

  it('sends the email and the portal language, closes, and the pending row appears', async () => {
    const { user, stub, router } = portal(({ body }) => ok(pending((body as { email: string }).email), 201));
    await send(user, 'maya@ledger.co');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = stub.calls.find((call) => call.method === 'POST');
    expect(post?.body).toEqual({ email: 'maya@ledger.co', locale: 'en' });
    expect(locationOf(router)).not.toContain('invite');
    expect(await screen.findByText(`Invite sent to ${iso('maya@ledger.co')}`)).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('maya@ledger.co');
  });

  it('in Arabic, the email goes in Arabic', async () => {
    const { user, stub } = portal(({ body }) => ok(pending((body as { email: string }).email), 201), account(), 'ar');
    const dialog = await screen.findByRole('dialog', { name: 'دعوة محاسب' });
    await user.type(within(dialog).getByLabelText('البريد الإلكتروني'), 'maya@ledger.co');
    await user.click(screen.getByRole('button', { name: 'إرسال الدعوة' }));
    await waitFor(() => expect(stub.calls.find((call) => call.method === 'POST')?.body).toEqual({ email: 'maya@ledger.co', locale: 'ar' }));
  });

  it.each([
    ['SELF_INVITE', () => fail(422, 'VALIDATION_FAILED', { reason: 'SELF_INVITE' }), "That's your own email. Use your accountant's."],
    ['INVITE_ADDRESS_REFUSED', () => fail(422, 'VALIDATION_FAILED', { reason: 'INVITE_ADDRESS_REFUSED' }), "We can't send invites to this address. Use your accountant's own email."],
  ])('%s shows under the field, which is marked invalid', async (_code, answer, message) => {
    const { user } = portal(answer);
    const dialog = await send(user, 'nour@firm.ps');
    const field = within(dialog).getByLabelText('Email');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByText(message)).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(message);
  });

  it.each([
    ['ALREADY_INVITED', () => fail(409, 'CONFLICT', { reason: 'ALREADY_INVITED' }), `${iso('sami@khoury-cpa.com')} already has an invite or access to this profile.`],
    ['ACCOUNTANT_LIMIT', () => fail(409, 'CONFLICT', { reason: 'ACCOUNTANT_LIMIT', limit: 5 }), 'This profile already has 5 accountants or invites, the most it can. Stop one first.'],
    ['RATE_LIMITED', () => fail(429, 'RATE_LIMITED'), 'Too many invites in an hour. Try again later.'],
    ['the network', () => Promise.reject(new TypeError('offline')), "Couldn't reach MTB3A. Check your connection and send again."],
  ])('%s shows in the banner and the drawer stays open', async (_code, answer, message) => {
    const { user } = portal(answer as Handler);
    const dialog = await send(user, 'sami@khoury-cpa.com');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  });

  it('an empty or malformed address is refused before anything is sent', async () => {
    const { user, stub } = portal(() => ok(pending('x'), 201));
    const dialog = await screen.findByRole('dialog', { name: 'Invite an accountant' });
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(within(dialog).getByText('Enter an email address, like name@firm.ps.')).toBeInTheDocument();
    expect(stub.count(`POST /v1/profiles/${ORG_B}/accountants`)).toBe(0);
  });

  it('is busy while sending: one request, however many presses', async () => {
    const { user, stub } = portal(never);
    await send(user, 'maya@ledger.co');
    const button = screen.getByRole('button', { name: /Send invite|Sending/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(stub.count(`POST /v1/profiles/${ORG_B}/accountants`)).toBe(1);
  });

  it('under the lapse gate it opens read-only: the note, no Send', async () => {
    const locked: BillingEntitlement = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };
    portal(() => ok(pending('x'), 201), account({ profiles: [{ ...studio, billing: locked }], billingStanding: 'locked' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite an accountant' });
    expect(within(dialog).getByRole('note')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send invite' })).not.toBeInTheDocument();
  });
});
