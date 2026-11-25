# MUT-571 + MUT-572 — Connect a profile to the Tax Authority, and allocation numbers on issued invoices

Status: **In Progress 2026-11-22** (lane D of the overnight run; Basel approved sandbox calls: "yes go ahead (I approve, need to test the tax authority integrations)") · Epic MUT-566 · ADR-264 · API 1.120.0-mut571 (MUT-570 takes 1.119.0)

## Sources
- `OpenApiUserGuide.pdf`: OAuth 2.0 authorization code, `longtimetoken`; token POST with `Basic base64(client_id:client_secret)`; refresh tokens exist.
- Tax Authority NodeJsExample (github.com/IsrTaxesOpenAPI/NodeJsExample): a refresh posts `client_id`/`client_secret` in the form; API calls carry `Authorization: Bearer`.
- `invoices_v2.json` (POST /Invoices/v2/Approval):
  - scope `invoices_scope`;
  - sandbox test dealers 777777715 (approve), 777777723 (held), 777777731 / 777777749 (found invoice states);
  - test software number 987654321.
- `invoicedecisionapi_v1.json` (Cancel / Continue / FurtherObjection).
- Sandbox app "MTB3A", redirect `http://localhost:8787/v1/issuing/tax-authority/callback` (registered by Basel).

## Acceptance criteria
MUT-571:
1. A profile connects through the sandbox and shows "connected until <date>".
2. Two concurrent requests never use the same refresh token twice (test).
3. The reminder is sent 10 days before expiry; an expired connection is shown and asks to reconnect.
4. Tokens and the client secret never appear in logs or Sentry (test).

MUT-572:
1. Above the threshold a sandbox number is printed on the invoice and PDF; below it, no call is made.
2. A held response shows the four choices, and the choice is reported.
3. A timeout followed by a retry yields one invoice and one number (test).
4. A not-connected profile can't issue above the threshold.

## As built
- **Config** (off unless `TAX_AUTHORITY_ENV`):
  - `TAX_AUTHORITY_ENV` (sandbox|production), `_BASE_URL` (default `https://openapi.taxes.gov.il/shaam/tsandbox`), `_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI`, `_SCOPE` (default `invoices_scope`), `_SOFTWARE_NUMBER` (default 987654321, the spec's test value), `_TIMEOUT_MS`, `_TOKEN_KEY`.
  - Production refuses missing values and sandbox defaults.
- **Storage:**
  - `tax_authority_connections`: sealed access and refresh tokens, their expiries, who connected, `version`.
  - AES-256-GCM `TokenBox`, keyed by `TAX_AUTHORITY_TOKEN_KEY`, or by the session pepper outside production and staging.
- **Routes:**
  - `GET /v1/issuing/tax-authority` (status);
  - `POST /v1/issuing/tax-authority/connect` (owner; the authorize URL with a signed 10-minute state);
  - `GET /v1/issuing/tax-authority/callback` (public; state only; redirects to the portal's `/p/:id/you/invoicing?taxAuthority=connected|failed`);
  - `DELETE /v1/issuing/tax-authority`;
  - `POST /v1/issuing/allocation-decisions` (CANCEL / FURTHER_OBJECTION).
  - The setup's taxAuthority step is `done` while connected.
- **Allocation** in `POST /v1/issued-documents`:
  - Applies to a 305/320, to a customer with a VAT number, at or over the dated threshold (`israel/allocation-number.ts`, ADR-246).
  - The Approval call runs inside the issue transaction after the counter lock (ADR-264); the document stores the last 9 digits.
  - Refusals: 409 `TAX_AUTHORITY_NOT_CONNECTED`; 409 `ALLOCATION_HELD` (choices); 422 `ALLOCATION_REFUSED` (codes); 502 `TAX_AUTHORITY_UNAVAILABLE` (send the same request again).
  - `withoutAllocation.heldKey` reports CONTINUE and issues without a number.

## Not in this ticket (stated)
- **Reverse charge** (Approval `action` 3, VAT 0): needs the compose rules for VAT 0. Follow-up.
- ~~**The 10-day reminder mail and portal banner** (MUT-571 AC3)~~: done in the invoicing follow-ups (2026-11-22, ADR-264 amendment): the daily reminder job and the setup step's notice.
- **Held error codes:** not published. The sandbox's held test dealer (777777723) is how to learn them; `HELD_ERROR_CODES` is empty until then.
- **The portal and phone UI for connect and the four choices** (MUT-570/573/574).
