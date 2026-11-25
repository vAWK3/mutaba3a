/**
 * ADR-278 (the legal pages rewrite): the mails a person can opt out of, and the one-click unsubscribe headers
 * (RFC 2369 List-Unsubscribe, RFC 8058 List-Unsubscribe-Post) that let a mail client do it without opening a page.
 * The URL is the API under the portal's origin (the portal reaches the API at `/v1`), and its token is the person's
 * mail-off token (mail-off-token.ts): it names one person and switches only their own mail preferences.
 */
export const OPT_OUT_MAILS = ['offers', 'monthly-summary'] as const;
export type OptOutMail = (typeof OPT_OUT_MAILS)[number];

/** The only headers a mail may add (the Resend transport drops any other), so no tracking header can ride along. */
export const ALLOWED_MAIL_HEADERS = ['List-Unsubscribe', 'List-Unsubscribe-Post'] as const;

export function unsubscribeUrl(portalOrigin: string, mail: OptOutMail, token: string): string {
  return `${portalOrigin.replace(/\/+$/, '')}/v1/mail-preferences/unsubscribe?mail=${mail}&token=${token}`;
}

export function unsubscribeHeaders(portalOrigin: string, mail: OptOutMail, token: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${unsubscribeUrl(portalOrigin, mail, token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}
