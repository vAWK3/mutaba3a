import { CloudTasksClient } from '@google-cloud/tasks';
import type { ReadDispatcher } from './dispatcher.js';

/** MUT-441: the read job's path; the task, the sweep and the route all name it from here. */
export const RECEIPT_READ_JOB_PATH = '/jobs/v1/receipts/read';
/** F10: Cloud Tasks waits this long for the job route; the OCR call inside it gives up at 35 s. */
export const READ_DISPATCH_DEADLINE_SECONDS = 60;
/** gRPC ALREADY_EXISTS: a task by that name exists or ran recently, so this attempt is already queued. */
const ALREADY_EXISTS = 6;

/** The one call this adapter makes, so tests can stand in for Google's client. */
export interface TasksClient {
  createTask(request: {
    parent: string;
    task: {
      name: string;
      dispatchDeadline: { seconds: number };
      httpRequest: { httpMethod: 'POST'; url: string; headers: Record<string, string>; body: string; oidcToken: { serviceAccountEmail: string; audience: string } };
    };
  }): Promise<unknown>;
}

export interface CloudTasksDispatcherOptions {
  /** READ_QUEUE: projects/<project>/locations/<region>/queues/<queue>. */
  queue: string;
  /** API_ORIGIN: where the task POSTs (`<origin>/jobs/v1/receipts/read`). */
  apiOrigin: string;
  /** READ_INVOKER_SA: the service account the task's OIDC token is minted for. */
  invokerServiceAccount: string;
  /** READ_OIDC_AUDIENCE: the token's audience, which the job route checks (R8). */
  audience: string;
  client?: TasksClient;
}

/**
 * MUT-441 (F3, R8, R10 #7): one HTTP task per read attempt, carrying a Google-signed OIDC token and no shared secret.
 * The task is named `<receiptId>-<attempt>`, so a second ask for the same attempt is dropped by Cloud Tasks.
 */
export class CloudTasksDispatcher implements ReadDispatcher {
  private readonly client: TasksClient;
  private readonly url: string;

  constructor(private readonly options: CloudTasksDispatcherOptions) {
    this.client = options.client ?? (new CloudTasksClient() as unknown as TasksClient);
    this.url = `${options.apiOrigin.replace(/\/+$/, '')}${RECEIPT_READ_JOB_PATH}`;
  }

  async enqueue(receiptId: string, attempt: number): Promise<void> {
    try {
      await this.client.createTask({
        parent: this.options.queue,
        task: {
          name: `${this.options.queue}/tasks/${receiptId}-${attempt}`,
          dispatchDeadline: { seconds: READ_DISPATCH_DEADLINE_SECONDS },
          httpRequest: {
            httpMethod: 'POST',
            url: this.url,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify({ receiptId })).toString('base64'),
            oidcToken: { serviceAccountEmail: this.options.invokerServiceAccount, audience: this.options.audience },
          },
        },
      });
    } catch (err) {
      if ((err as { code?: unknown }).code === ALREADY_EXISTS) return;
      throw err;
    }
  }
}
