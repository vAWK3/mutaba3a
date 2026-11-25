import { test, expect } from '../../support/qa';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';

/**
 * MUT-710 (AC4, D10): issuing needs two-step sign-in. The gate ships off on the dev API, so the server's refusal
 * (403 TWO_FACTOR_SETUP_REQUIRED) is stubbed over the fake API; what is checked is what the portal does with it.
 */

const OFF = { enabled: false, method: null, recoveryCodesLeft: 0, requiredForIssuing: false };

test('issuing without two-step sign-in shows why, and Set up opens the two-step drawer over the issue drawer', { tag: '@portal.two-factor.issuing-required' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1, clientPreference: 'TAX_INVOICE_FIRST', invoicing: 'ready' });
  const issue = page.getByRole('dialog', { name: 'Issue a document' });

  await step('Open Documents › Issued and choose Issue a document; the server will refuse issuing and answer the two-step state', async () => {
    await api.open(page, `/p/${OFFICE_A}/documents/issued`);
    await page.route('**/v1/issued-documents', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TWO_FACTOR_SETUP_REQUIRED', message: 'Two-step sign-in is required to issue', details: { enrolled: false } } }) })
        : route.fallback(),
    );
    await page.route('**/v1/me/two-factor', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OFF) }));
    await page.getByTestId('issue-open').click();
    await expect(issue).toBeVisible();
  });
  await step('Fill a client and a line and press Issue: the prompt says two-step sign-in is required, not "failed"', async () => {
    await issue.getByLabel('Client').fill('Client 1');
    await page.getByRole('option', { name: /Client 1/ }).click();
    await issue.getByLabel('Description').fill('Flutter development, sprint 3');
    await issue.getByLabel('Quantity').fill('40');
    await issue.getByRole('textbox', { name: 'Price', exact: true }).fill('450');
    await page.getByTestId('issue-submit').click();
    const prompt = issue.getByTestId('two-factor-issuing-prompt');
    await expect(prompt).toContainText('Two-step sign-in is required to issue documents.');
    await expect(issue.getByText('The document could not be issued')).toHaveCount(0);
  });
  await step('Press Set up two-step sign-in: the drawer to turn it on opens, and the issue drawer keeps what was typed', async () => {
    await issue.getByRole('button', { name: 'Set up two-step sign-in' }).click();
    await expect(page.getByRole('dialog', { name: 'Turn on two-step sign-in' })).toBeVisible();
    await expect(page).toHaveURL(/twoFactor=true/);
    await expect(issue.getByLabel('Description')).toHaveValue('Flutter development, sprint 3');
  });
});
