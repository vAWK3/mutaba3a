import type { CDPSession, Page } from '@playwright/test';

/**
 * MUT-115: Chromium's virtual authenticator (CDP WebAuthn domain) stands in for Touch ID / Face ID, so the portal's
 * passkey flows run end to end against the live API's real WebAuthn checks (support/selfservice-live.mjs serves the
 * portal on http://localhost:8791 with WEBAUTHN_RP_ID=localhost). A platform authenticator that holds discoverable
 * credentials and always verifies the user: the sheet "succeeds" at once.
 */
export interface VirtualAuthenticator {
  cdp: CDPSession;
  authenticatorId: string;
  /** How many passkeys the authenticator holds for any site. */
  count(): Promise<number>;
  /** Stop answering: the next ceremony is a cancel (NotAllowedError), as when the person dismisses the sheet. */
  setPresence(present: boolean): Promise<void>;
}

export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    cdp,
    authenticatorId,
    count: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length,
    setPresence: async (present) => {
      await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: present });
    },
  };
}
