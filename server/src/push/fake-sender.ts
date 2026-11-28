import type { PushDelivery, PushOutcome, PushSender } from './ports.js';

/** Tests and local runs: records what would have been sent. `outcomeFor` decides each answer (default `sent`). */
export class FakePushSender implements PushSender {
  readonly deliveries: PushDelivery[] = [];
  constructor(private readonly outcomeFor: (delivery: PushDelivery) => PushOutcome = () => 'sent') {}

  async send(delivery: PushDelivery): Promise<PushOutcome> {
    this.deliveries.push(delivery);
    return this.outcomeFor(delivery);
  }
}
