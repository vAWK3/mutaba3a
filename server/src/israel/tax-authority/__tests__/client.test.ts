import { describe, expect, it } from 'vitest';
import { approvalBody, HELD_ERROR_CODES, HttpTaxAuthorityClient, TaxAuthorityError, type ApprovalRequest } from '../client.js';

/** MUT-571/572: the wire shapes the guide, the NodeJsExample and the specs give, against a stubbed fetch. */
function client(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer(url, init);
  }) as unknown as typeof fetch;
  const c = new HttpTaxAuthorityClient({ environment: 'sandbox', baseUrl: 'https://openapi.taxes.gov.il/shaam/tsandbox', clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://localhost:8787/v1/issuing/tax-authority/callback', scope: 'invoices_scope', timeoutMs: 1000, fetch: fetcher });
  return { c, calls };
}
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const REQUEST: ApprovalRequest = {
  invoiceId: 'abc',
  userName: 'Basel Sader, Barmajiyat Software Ltd.',
  invoiceType: 305,
  vatNumber: 777777715,
  invoiceReferenceNumber: '1042',
  customerVatNumber: 516123452,
  customerName: 'Acme Digital Ltd. with a very long legal name',
  invoiceDate: '2026-11-05',
  invoiceIssuanceDate: '2026-11-05',
  accountingSoftwareNumber: 987654321,
  amountBeforeDiscount: 6000,
  discount: 0,
  paymentAmount: 6000,
  vatAmount: 1080,
  paymentAmountIncludingVat: 7080,
  items: [{ index: 1, category: 2, description: 'פיתוח אפליקציה – ספרינט שלישי ואחרון', quantity: 1, pricePerUnit: 6000, discount: 0, totalAmount: 6000, vatRate: 18, vatAmount: 1080 }],
};

describe('HttpTaxAuthorityClient', () => {
  it('builds the authorize address with the code flow, scope, redirect and state', () => {
    const url = new URL(client(() => ok({})).c.authorizeUrl('s1'));
    expect(url.origin + url.pathname).toBe('https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', client_id: 'cid', scope: 'invoices_scope', redirect_uri: 'http://localhost:8787/v1/issuing/tax-authority/callback', state: 's1' });
  });

  it('swaps a code with Basic client credentials; refreshes with them in the form', async () => {
    const { c, calls } = client(() => ok({ access_token: 'a1', expires_in: 600, refresh_token: 'r1', consented_on: 1763712000 }));
    expect(await c.exchangeCode('code-1')).toMatchObject({ accessToken: 'a1', expiresIn: 600, refreshToken: 'r1' });
    expect(calls[0]!.url).toBe('https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    expect(String(calls[0]!.init.body)).toBe('grant_type=authorization_code&code=code-1&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fv1%2Fissuing%2Ftax-authority%2Fcallback&scope=invoices_scope');
    await c.refresh('r1');
    expect(new URLSearchParams(String(calls[1]!.init.body)).get('grant_type')).toBe('refresh_token');
    expect(new URLSearchParams(String(calls[1]!.init.body)).get('client_secret')).toBe('csecret');
  });

  it('a refused token request throws without the answer in its message', async () => {
    const { c } = client(() => ok({ error: 'invalid_grant', access_token_hint: 'secret-ish' }, 400));
    const error = await c.exchangeCode('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TaxAuthorityError);
    expect((error as Error).message).not.toContain('secret-ish');
  });

  it('approval: snake_case, cut to the service lengths, Bearer token; approved, refused and unavailable answers', async () => {
    const { c, calls } = client(() => ok({ status: 200, message: 'Invoice approved', confirmation_number: '20240718181618323199093572', approved: true }));
    expect(await c.approve('tok', REQUEST)).toEqual({ kind: 'approved', confirmationNumber: '20240718181618323199093572' });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe('https://openapi.taxes.gov.il/shaam/tsandbox/Invoices/v2/Approval');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(body).toMatchObject({ invoice_id: 'abc', invoice_type: 305, vat_number: 777777715, customer_vat_number: 516123452, payment_amount_including_vat: 7080 });
    expect(body.customer_name).toHaveLength(25);
    expect(body.items[0].description.length).toBeLessThanOrEqual(30);

    const refused = client(() => ok({ status: 400, message: { errors: [{ code: 434, message: 'Invoice date is too old for approval', param: 'invoice_date' }] }, confirmation_number: '0', approved: false }, 400));
    expect(await refused.c.approve('tok', REQUEST)).toEqual({ kind: 'refused', errors: [{ code: 434, message: 'Invoice date is too old for approval', param: 'invoice_date' }] });
    expect(await client(() => ok({ status: 500 }, 500)).c.approve('tok', REQUEST)).toEqual({ kind: 'unavailable' });
    expect(await client(() => ok({}, 401)).c.approve('tok', REQUEST)).toEqual({ kind: 'unauthorized' });
  });
});

describe('the Approval body (sandbox error 446)', () => {
  it("names who issues it, cut to the service's 25 characters", () => {
    expect(approvalBody(REQUEST).user_name).toBe('Basel Sader, Barmajiyat S');
  });
});

describe('a held number (sandbox dealer 777777723)', () => {
  it('reads error 460 as held, not refused', () => {
    expect(HELD_ERROR_CODES.has(460)).toBe(true);
  });
});
