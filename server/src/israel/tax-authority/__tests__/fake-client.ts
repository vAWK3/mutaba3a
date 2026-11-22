import type { ApprovalAnswer, ApprovalRequest, DecisionChoice, TaxAuthorityClient, TaxAuthorityTokens } from '../client.js';

/**
 * MUT-571/572: a Tax Authority that answers from a script. Each token it hands out is unique and recorded, so a test can
 * prove a refresh token is spent once and that no token reaches an answer or a log.
 */
export class FakeTaxAuthority implements TaxAuthorityClient {
  readonly environment = 'sandbox';
  readonly approvals: { token: string; request: ApprovalRequest }[] = [];
  readonly decisions: { choice: DecisionChoice; invoiceId: string }[] = [];
  readonly refreshesSent: string[] = [];
  readonly issuedTokens: string[] = [];
  /** What the next Approval calls answer, in order; then `approved` with a 26-digit confirmation. */
  answers: (ApprovalAnswer | 'throw')[] = [];
  /** Seconds a new access token lives. */
  accessSeconds = 600;
  private serial = 0;

  authorizeUrl(state: string): string {
    return `https://openapi.example.test/shaam/tsandbox/longtimetoken/oauth2/authorize?response_type=code&state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<TaxAuthorityTokens> {
    if (code !== 'good-code') throw new Error('refused');
    return this.tokens();
  }

  async refresh(refreshToken: string): Promise<TaxAuthorityTokens> {
    if (this.refreshesSent.includes(refreshToken)) throw new Error('refresh token reused');
    this.refreshesSent.push(refreshToken);
    // A round trip, so two callers would overlap without the lock.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return this.tokens();
  }

  async approve(token: string, request: ApprovalRequest): Promise<ApprovalAnswer> {
    this.approvals.push({ token, request });
    const next = this.answers.shift();
    if (next === 'throw') throw new Error('socket hang up');
    return next ?? { kind: 'approved', confirmationNumber: `2026112212000000000${String(100000 + this.approvals.length).padStart(7, '0')}` };
  }

  async decide(_token: string, choice: DecisionChoice, request: { invoiceId: string }) {
    this.decisions.push({ choice, invoiceId: request.invoiceId });
    return { ok: true, message: null };
  }

  private tokens(): TaxAuthorityTokens {
    this.serial += 1;
    const accessToken = `access-${this.serial}-secret-value`;
    const refreshToken = `refresh-${this.serial}-secret-value`;
    this.issuedTokens.push(accessToken, refreshToken);
    return { accessToken, expiresIn: this.accessSeconds, refreshToken, consentedOn: new Date('2026-11-01T08:00:00Z') };
  }
}
