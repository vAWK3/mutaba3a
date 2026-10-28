import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudTasksDispatcher, type TasksClient } from '../reading/cloud-tasks.js';
import { InlineDispatcher } from '../reading/dispatcher.js';

/** MUT-441 (F3, R8, R10 #7): the two ways a read is scheduled. */
const QUEUE = 'projects/p/locations/me-west1/queues/receipt-reads';

function tasks(fail?: unknown) {
  const created: Parameters<TasksClient['createTask']>[0][] = [];
  const client: TasksClient = {
    createTask: async (request) => {
      if (fail) throw fail;
      created.push(request);
      return {};
    },
  };
  return { client, created };
}

describe('CloudTasksDispatcher', () => {
  it('creates one named HTTP task with a Google OIDC token and no shared secret', async () => {
    const { client, created } = tasks();
    const dispatcher = new CloudTasksDispatcher({ queue: QUEUE, apiOrigin: 'https://api.example.test/', invokerServiceAccount: 'reads@p.iam.gserviceaccount.com', audience: 'https://api.example.test', client });
    await dispatcher.enqueue('3f1c0e8a-0000-4000-8000-000000000001', 2);
    expect(created).toEqual([
      {
        parent: QUEUE,
        task: {
          name: `${QUEUE}/tasks/3f1c0e8a-0000-4000-8000-000000000001-2`,
          dispatchDeadline: { seconds: 60 },
          httpRequest: {
            httpMethod: 'POST',
            url: 'https://api.example.test/jobs/v1/receipts/read',
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify({ receiptId: '3f1c0e8a-0000-4000-8000-000000000001' })).toString('base64'),
            oidcToken: { serviceAccountEmail: 'reads@p.iam.gserviceaccount.com', audience: 'https://api.example.test' },
          },
        },
      },
    ]);
    expect(JSON.stringify(created)).not.toMatch(/x-job-token/i);
  });

  it('a task that already exists (the same attempt asked twice) is success; any other failure throws', async () => {
    const options = { queue: QUEUE, apiOrigin: 'https://api.example.test', invokerServiceAccount: 'r@p.iam.gserviceaccount.com', audience: 'https://api.example.test' };
    await expect(new CloudTasksDispatcher({ ...options, client: tasks({ code: 6 }).client }).enqueue('id', 0)).resolves.toBeUndefined();
    await expect(new CloudTasksDispatcher({ ...options, client: tasks({ code: 14 }).client }).enqueue('id', 0)).rejects.toMatchObject({ code: 14 });
  });
});

describe('InlineDispatcher', () => {
  it('runs the read after the caller returns, once per attempt while queued, and swallows the read\'s failure', async () => {
    const dispatcher = new InlineDispatcher();
    const ran: string[] = [];
    dispatcher.bind(async (id) => {
      ran.push(id);
      if (id === 'b') throw new Error('boom');
    });
    await dispatcher.enqueue('a', 0);
    await dispatcher.enqueue('a', 0);
    await dispatcher.enqueue('b', 0);
    expect(ran).toEqual([]);
    await dispatcher.idle();
    expect(ran).toEqual(['a', 'b']);
    await dispatcher.enqueue('a', 0);
    await dispatcher.idle();
    expect(ran).toEqual(['a', 'b', 'a']);
  });

  describe('with a QA delay (QA_READ_DELAY_MS)', () => {
    afterEach(() => vi.useRealTimers());

    it('waits that long before the read, standing in for Cloud Tasks\' dispatch and a cold start', async () => {
      vi.useFakeTimers();
      const dispatcher = new InlineDispatcher({ delayMs: 5_000 });
      const ran: string[] = [];
      dispatcher.bind(async (id) => {
        ran.push(id);
      });
      await dispatcher.enqueue('a', 0);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(ran).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(ran).toEqual(['a']);
    });
  });
});
