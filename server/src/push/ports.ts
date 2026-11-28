import type { PushPlatform } from '../repositories/ports.js';

/**
 * MUT-780 (ADR-350): what a push is, and the one thing that delivers it. The production sender is FCM's
 * (push/fcm-sender.ts); tests use the fake. A direct APNs sender would implement the same interface.
 */
export type PushKind = 'unclaimed_digest';

/** What a feature asks for; the words are chosen per person's locale by push/messages.ts. */
export interface PushRequest {
  kind: PushKind;
  /** Numbers the copy uses; never a name or an address. */
  vars: Readonly<Record<string, number>>;
  /** Handed to the app on a tap. Strings only (FCM data). `kind` is added by the service. */
  data: Readonly<Record<string, string>>;
}

export interface PushDelivery {
  platform: PushPlatform;
  token: string;
  title: string;
  body: string;
  data: Readonly<Record<string, string>>;
}

/** `invalid_token`: the platform says this token is gone for good (uninstalled, rotated): drop it. */
export type PushOutcome = 'sent' | 'invalid_token' | 'failed';

export interface PushSender {
  send(delivery: PushDelivery): Promise<PushOutcome>;
}
