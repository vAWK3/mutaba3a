import { describe, it, expect } from 'vitest';

// We need to test normalizeTransaction which is not exported directly.
// Instead, test through the moneyEventRepo which uses it.
// For unit testing the normalization logic, we'll test the observable behavior.

import { db } from '../database';
import { moneyEventRepo } from '../moneyEventRepository';
import { beforeEach, afterEach } from 'vitest';

describe('moneyEventRepo — partial payment normalization', () => {
  const profileId = 'test-profile';
  const month = '2099-01';

  beforeEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();

    await db.businessProfiles.add({
      id: profileId,
      name: 'Test Profile',
      isDefault: true,
      createdAt: '2099-01-01T00:00:00Z',
    });
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();
  });

  it('should normalize paid income as state=paid', async () => {
    await db.transactions.add({
      id: 'tx-paid',
      kind: 'income',
      status: 'paid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2099-01-15',
      paidAt: '2099-01-15T10:00:00Z',
      profileId,
      createdAt: '2099-01-15T00:00:00Z',
      updatedAt: '2099-01-15T00:00:00Z',
    });

    const events = await moneyEventRepo.getMoneyEvents({
      month,
      currency: 'USD',
      profileId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].state).toBe('paid');
    expect(events[0].source).toBe('actual_income');
  });

  it('should normalize unpaid income as state=unpaid', async () => {
    await db.transactions.add({
      id: 'tx-unpaid',
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2099-01-15',
      dueDate: '2099-01-31',
      profileId,
      createdAt: '2099-01-15T00:00:00Z',
      updatedAt: '2099-01-15T00:00:00Z',
    });

    const events = await moneyEventRepo.getMoneyEvents({
      month,
      currency: 'USD',
      profileId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].state).toBe('unpaid');
    expect(events[0].source).toBe('receivable');
  });

  it('should normalize partial payment as state=partial with receivedAmountMinor', async () => {
    await db.transactions.add({
      id: 'tx-partial',
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      receivedAmountMinor: 3000,
      currency: 'USD',
      occurredAt: '2099-01-15',
      dueDate: '2099-01-31',
      profileId,
      createdAt: '2099-01-15T00:00:00Z',
      updatedAt: '2099-01-15T00:00:00Z',
    });

    const events = await moneyEventRepo.getMoneyEvents({
      month,
      currency: 'USD',
      profileId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].state).toBe('partial');
    expect(events[0].source).toBe('receivable');
    expect(events[0].amountMinor).toBe(10000);
    expect(events[0].receivedAmountMinor).toBe(3000);
  });

  it('should normalize overdue unpaid income as state=overdue', async () => {
    await db.transactions.add({
      id: 'tx-overdue',
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2020-01-01',
      dueDate: '2020-01-10',
      profileId,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    });

    const events = await moneyEventRepo.getMoneyEvents({
      month: '2020-01',
      currency: 'USD',
      profileId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].state).toBe('overdue');
  });

  it('should include receivedAmountMinor in the event output', async () => {
    await db.transactions.add({
      id: 'tx-with-received',
      kind: 'income',
      status: 'paid',
      amountMinor: 10000,
      receivedAmountMinor: 10000,
      currency: 'USD',
      occurredAt: '2099-01-15',
      paidAt: '2099-01-15T10:00:00Z',
      profileId,
      createdAt: '2099-01-15T00:00:00Z',
      updatedAt: '2099-01-15T00:00:00Z',
    });

    const events = await moneyEventRepo.getMoneyEvents({
      month,
      currency: 'USD',
      profileId,
    });

    expect(events[0].receivedAmountMinor).toBe(10000);
  });
});
