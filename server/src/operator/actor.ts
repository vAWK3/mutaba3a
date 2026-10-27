/**
 * MUT-459 (ADR-212): who did an operator action. The admin token (the CLI) carries no identity; the portal's operator
 * console is a signed-in operator. One action module serves both, and these two helpers are the only place the
 * difference shows: the audit row's actorId and the `decidedBy` / `grantedBy` label.
 */
export type OperatorActor = { kind: 'token' } | { kind: 'operator'; userId: string };

export const TOKEN_ACTOR: OperatorActor = { kind: 'token' };

/** The audit row's actorId under actorType ADMIN: null for the token (as before MUT-459), the operator's id otherwise. */
export function auditActorIdOf(actor: OperatorActor): string | null {
  return actor.kind === 'operator' ? actor.userId : null;
}

/** A stored "by" column: the token keeps the label it always wrote (`tokenLabel`); an operator is `operator:<id>`. */
export function byLabelOf(actor: OperatorActor, tokenLabel: string): string {
  return actor.kind === 'operator' ? `operator:${actor.userId}` : tokenLabel;
}

/** The request facts every operator action needs: who, when, and the request it answers. */
export interface ActionContext {
  actor: OperatorActor;
  at: Date;
  requestId: string | null;
  requestUrl: string;
}
