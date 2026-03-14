import { describe, it, expect, beforeEach } from 'vitest';
import { HybridLogicalClock, initializeClock } from '../hlc';
import type { Operation, OpType, EntityType } from '../ops-types';

describe('Operation Types and Structure', () => {
  describe('Operation Interface', () => {
    it('should have all required fields for a valid operation', () => {
      const op: Operation = {
        id: 'op-1',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'create',
        value: { id: 'client-1', name: 'Test Client' },
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
      };

      expect(op.id).toBeDefined();
      expect(op.hlc).toBeDefined();
      expect(op.entityType).toBeDefined();
      expect(op.entityId).toBeDefined();
      expect(op.opType).toBeDefined();
      expect(op.createdBy).toBeDefined();
      expect(op.createdAt).toBeDefined();
    });

    it('should support optional fields for update operations', () => {
      const op: Operation = {
        id: 'op-2',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'update',
        field: 'name',
        value: 'Updated Name',
        previousValue: 'Old Name',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
      };

      expect(op.field).toBe('name');
      expect(op.value).toBe('Updated Name');
      expect(op.previousValue).toBe('Old Name');
    });

    it('should support appliedAt for imported operations', () => {
      const op: Operation = {
        id: 'op-3',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'create',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
        appliedAt: '2026-03-13T01:00:00Z',
      };

      expect(op.appliedAt).toBe('2026-03-13T01:00:00Z');
    });
  });

  describe('Entity Types', () => {
    const entityTypes: EntityType[] = [
      'client',
      'project',
      'transaction',
      'category',
      'fxRate',
      'document',
      'businessProfile',
    ];

    entityTypes.forEach((entityType) => {
      it(`should support ${entityType} entity type`, () => {
        const op: Operation = {
          id: `op-${entityType}`,
          hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
          entityType,
          entityId: `${entityType}-1`,
          opType: 'create',
          createdBy: 'device-1',
          createdAt: '2026-03-13T00:00:00Z',
        };

        expect(op.entityType).toBe(entityType);
      });
    });
  });

  describe('Operation Types', () => {
    const opTypes: OpType[] = [
      'create',
      'update',
      'delete',
      'archive',
      'unarchive',
      'mark_paid',
      'create_version',
      'set_active_version',
      'resolve_conflict',
    ];

    opTypes.forEach((opType) => {
      it(`should support ${opType} operation type`, () => {
        const op: Operation = {
          id: `op-${opType}`,
          hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
          entityType: 'client',
          entityId: 'client-1',
          opType,
          createdBy: 'device-1',
          createdAt: '2026-03-13T00:00:00Z',
        };

        expect(op.opType).toBe(opType);
      });
    });
  });
});

describe('Operation HLC Ordering', () => {
  beforeEach(() => {
    initializeClock('test-device');
  });

  it('should order operations by HLC timestamp', () => {
    const ops: Operation[] = [
      {
        id: 'op-3',
        hlc: HybridLogicalClock.serialize({ ts: 3000, counter: 0, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'create',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:02Z',
      },
      {
        id: 'op-1',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-2',
        opType: 'create',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
      },
      {
        id: 'op-2',
        hlc: HybridLogicalClock.serialize({ ts: 2000, counter: 0, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-3',
        opType: 'create',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:01Z',
      },
    ];

    // Sort by HLC string (lexicographic)
    const sorted = [...ops].sort((a, b) => a.hlc.localeCompare(b.hlc));

    expect(sorted[0].id).toBe('op-1');
    expect(sorted[1].id).toBe('op-2');
    expect(sorted[2].id).toBe('op-3');
  });

  it('should order operations by counter when timestamps are equal', () => {
    const ops: Operation[] = [
      {
        id: 'op-3',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 3, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'update',
        field: 'name',
        value: 'Third update',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
      },
      {
        id: 'op-1',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 1, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'update',
        field: 'name',
        value: 'First update',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
      },
      {
        id: 'op-2',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 2, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'update',
        field: 'name',
        value: 'Second update',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
      },
    ];

    const sorted = [...ops].sort((a, b) => a.hlc.localeCompare(b.hlc));

    expect(sorted[0].id).toBe('op-1');
    expect(sorted[1].id).toBe('op-2');
    expect(sorted[2].id).toBe('op-3');
  });

  it('should use nodeId for tie-breaking when timestamp and counter are equal', () => {
    const ops: Operation[] = [
      {
        id: 'op-b',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-bbb' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'update',
        field: 'name',
        value: 'From node B',
        createdBy: 'device-b',
        createdAt: '2026-03-13T00:00:00Z',
      },
      {
        id: 'op-a',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-aaa' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'update',
        field: 'name',
        value: 'From node A',
        createdBy: 'device-a',
        createdAt: '2026-03-13T00:00:00Z',
      },
    ];

    const sorted = [...ops].sort((a, b) => a.hlc.localeCompare(b.hlc));

    expect(sorted[0].id).toBe('op-a');
    expect(sorted[1].id).toBe('op-b');
  });
});

describe('Operation Serialization', () => {
  it('should serialize operation HLC for storage and comparison', () => {
    const hlc = { ts: 1700000000000, counter: 42, nodeId: 'device-1' };
    const serialized = HybridLogicalClock.serialize(hlc);

    expect(typeof serialized).toBe('string');
    expect(serialized.length).toBeGreaterThan(0);
  });

  it('should roundtrip HLC through serialization', () => {
    const original = { ts: 1234567890123, counter: 99, nodeId: 'testnode' };
    const serialized = HybridLogicalClock.serialize(original);
    const parsed = HybridLogicalClock.parse(serialized);

    expect(parsed.ts).toBe(original.ts);
    expect(parsed.counter).toBe(original.counter);
  });

  it('should maintain chronological order through serialization', () => {
    const earlier = HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node' });
    const later = HybridLogicalClock.serialize({ ts: 2000, counter: 0, nodeId: 'node' });

    expect(earlier < later).toBe(true);
  });
});

describe('Operation Field Updates', () => {
  it('should track field-level changes for LWW', () => {
    const updateOps: Operation[] = [
      {
        id: 'op-1',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'update',
        field: 'name',
        value: 'Alice',
        previousValue: 'Bob',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
      },
      {
        id: 'op-2',
        hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 1, nodeId: 'node-1' }),
        entityType: 'client',
        entityId: 'client-1',
        opType: 'update',
        field: 'email',
        value: 'alice@example.com',
        previousValue: 'bob@example.com',
        createdBy: 'device-1',
        createdAt: '2026-03-13T00:00:00Z',
      },
    ];

    // Each field update is tracked separately
    expect(updateOps[0].field).toBe('name');
    expect(updateOps[1].field).toBe('email');

    // Each has its own value and previousValue
    expect(updateOps[0].value).toBe('Alice');
    expect(updateOps[0].previousValue).toBe('Bob');
  });
});

describe('Operation Conflict Detection', () => {
  it('should identify concurrent operations from different nodes', () => {
    const op1: Operation = {
      id: 'op-from-node-a',
      hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-a' }),
      entityType: 'client',
      entityId: 'client-1',
      opType: 'update',
      field: 'name',
      value: 'Alice',
      createdBy: 'device-a',
      createdAt: '2026-03-13T00:00:00Z',
    };

    const op2: Operation = {
      id: 'op-from-node-b',
      hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-b' }),
      entityType: 'client',
      entityId: 'client-1',
      opType: 'update',
      field: 'name',
      value: 'Bob',
      createdBy: 'device-b',
      createdAt: '2026-03-13T00:00:00Z',
    };

    // Same entity, same field, different nodes, same timestamp
    expect(op1.entityId).toBe(op2.entityId);
    expect(op1.field).toBe(op2.field);
    expect(op1.createdBy).not.toBe(op2.createdBy);

    // HLCs should be different due to nodeId
    const hlc1 = HybridLogicalClock.parse(op1.hlc);
    const hlc2 = HybridLogicalClock.parse(op2.hlc);

    expect(hlc1.nodeId).not.toBe(hlc2.nodeId);

    // Compare returns non-zero when nodeIds differ
    expect(HybridLogicalClock.compare(hlc1, hlc2)).not.toBe(0);
  });

  it('should determine winner using HLC comparison', () => {
    const winnerOp: Operation = {
      id: 'winner',
      hlc: HybridLogicalClock.serialize({ ts: 2000, counter: 0, nodeId: 'node-1' }),
      entityType: 'client',
      entityId: 'client-1',
      opType: 'update',
      field: 'name',
      value: 'Winner Value',
      createdBy: 'device-1',
      createdAt: '2026-03-13T00:00:01Z',
    };

    const loserOp: Operation = {
      id: 'loser',
      hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-2' }),
      entityType: 'client',
      entityId: 'client-1',
      opType: 'update',
      field: 'name',
      value: 'Loser Value',
      createdBy: 'device-2',
      createdAt: '2026-03-13T00:00:00Z',
    };

    const winnerHlc = HybridLogicalClock.parse(winnerOp.hlc);
    const loserHlc = HybridLogicalClock.parse(loserOp.hlc);

    expect(HybridLogicalClock.gt(winnerHlc, loserHlc)).toBe(true);
  });
});

describe('Domain Operations', () => {
  it('should support mark_paid operation with timestamp', () => {
    const op: Operation = {
      id: 'mark-paid-1',
      hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
      entityType: 'transaction',
      entityId: 'tx-1',
      opType: 'mark_paid',
      value: '2026-03-13T16:00:00Z',
      createdBy: 'device-1',
      createdAt: '2026-03-13T16:00:00Z',
    };

    expect(op.opType).toBe('mark_paid');
    expect(op.value).toBe('2026-03-13T16:00:00Z');
  });

  it('should support archive operation with timestamp', () => {
    const op: Operation = {
      id: 'archive-1',
      hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
      entityType: 'project',
      entityId: 'project-1',
      opType: 'archive',
      value: '2026-03-13T17:00:00Z',
      createdBy: 'device-1',
      createdAt: '2026-03-13T17:00:00Z',
    };

    expect(op.opType).toBe('archive');
    expect(op.value).toBe('2026-03-13T17:00:00Z');
  });

  it('should support resolve_conflict operation', () => {
    const resolution = {
      conflictId: 'conflict-1',
      resolution: 'local',
    };

    const op: Operation = {
      id: 'resolve-1',
      hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
      entityType: 'client',
      entityId: 'client-1',
      opType: 'resolve_conflict',
      value: resolution,
      createdBy: 'device-1',
      createdAt: '2026-03-13T18:00:00Z',
    };

    expect(op.opType).toBe('resolve_conflict');
    expect((op.value as typeof resolution).conflictId).toBe('conflict-1');
    expect((op.value as typeof resolution).resolution).toBe('local');
  });

  it('should support set_active_version operation', () => {
    const versionData = {
      transactionId: 'tx-1',
      versionId: 'version-2',
    };

    const op: Operation = {
      id: 'set-version-1',
      hlc: HybridLogicalClock.serialize({ ts: 1000, counter: 0, nodeId: 'node-1' }),
      entityType: 'transaction',
      entityId: 'tx-1',
      opType: 'set_active_version',
      value: versionData,
      createdBy: 'device-1',
      createdAt: '2026-03-13T19:00:00Z',
    };

    expect(op.opType).toBe('set_active_version');
    expect((op.value as typeof versionData).transactionId).toBe('tx-1');
    expect((op.value as typeof versionData).versionId).toBe('version-2');
  });
});
