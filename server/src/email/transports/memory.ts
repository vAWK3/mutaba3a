import { randomUUID } from 'node:crypto';
import type { MailTransport, OutgoingMail } from '../ports.js';

/** A delivered mail as the memory outbox keeps it. */
export interface OutboxEntry extends OutgoingMail {
  id: string;
  at: string;
}

export const MEMORY_OUTBOX_LIMIT = 200;

/**
 * MUT-359: tests and QA. Keeps the last MEMORY_OUTBOX_LIMIT mails in order; `GET /admin/v1/dev-outbox` reads them
 * outside production (D11), so a spec can open a mail's link. Never used in production (config refuses it there).
 */
export class MemoryMailTransport implements MailTransport {
  readonly kind = 'memory' as const;
  private readonly entries: OutboxEntry[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async deliver(mail: OutgoingMail): Promise<{ id: string }> {
    const id = `mem_${randomUUID()}`;
    this.entries.push({ ...mail, id, at: this.now().toISOString() });
    if (this.entries.length > MEMORY_OUTBOX_LIMIT) this.entries.splice(0, this.entries.length - MEMORY_OUTBOX_LIMIT);
    return { id };
  }

  /** Oldest first; `to` filters by recipient, case-insensitively. */
  list(filter: { to?: string } = {}): OutboxEntry[] {
    const to = filter.to?.trim().toLowerCase();
    return this.entries.filter((e) => !to || e.to.toLowerCase() === to);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
