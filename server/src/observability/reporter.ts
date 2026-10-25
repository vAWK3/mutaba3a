/**
 * Where the server sends errors it can't handle (ADR-091, MUT-148). The API shell and the scripts
 * take an `ErrorReporter`, never the Sentry SDK: `app-shell.ts` is also bundled into the portal's
 * in-browser local mode, which must never report (ADR-024). Only `sentry-node.ts` imports the SDK.
 */
export interface ErrorContext {
  requestId?: string;
  /** The route template (`/v1/income/:id`), never the raw path. */
  route?: string;
}

/** MUT-434 (D14): tags on a security message. Ids and reasons only, never a token, a name or an email. */
export type MessageTags = Record<string, string>;

export interface ErrorReporter {
  readonly enabled: boolean;
  captureException(error: unknown, context?: ErrorContext): void;
  /** MUT-434 (D14): a security event worth seeing in Sentry that is not an error (a refresh token reused, a forced disconnect). */
  captureMessage(level: 'warning' | 'info', message: string, tags?: MessageTags): void;
  /** Resolves false when events are still pending after `timeoutMs`. */
  flush(timeoutMs: number): Promise<boolean>;
}

export const NOOP_REPORTER: ErrorReporter = Object.freeze({
  enabled: false,
  captureException: () => undefined,
  captureMessage: () => undefined,
  flush: async () => true,
});

/** How long a script waits for its crash report before the process ends. */
export const SCRIPT_FLUSH_TIMEOUT_MS = 2000;
/** Cloud Run allows 10 s after SIGTERM; closing and disconnecting take well under the rest. */
export const SHUTDOWN_FLUSH_TIMEOUT_MS = 2000;

export interface ShutdownSteps {
  stopAccepting: () => void;
  disconnect: () => Promise<void>;
  reporter: ErrorReporter;
  exit: (code: number) => void;
  logError?: (...args: unknown[]) => void;
}

/** AC6: pending reports are sent before the process ends, even when the disconnect fails. */
export async function shutdownAndFlush(steps: ShutdownSteps): Promise<void> {
  steps.stopAccepting();
  try {
    await steps.disconnect();
  } catch (error) {
    (steps.logError ?? console.error)('shutdown: disconnect failed', error);
  }
  await steps.reporter.flush(SHUTDOWN_FLUSH_TIMEOUT_MS);
  steps.exit(0);
}

export interface RunScriptHooks {
  setExitCode?: (code: number) => void;
  logError?: (...args: unknown[]) => void;
}

/**
 * Runs an operator script's body: a crash is logged, reported, and leaves exit code 1. Either way
 * pending events are flushed before the caller lets the process end.
 */
export async function runScript(name: string, reporter: ErrorReporter, body: () => Promise<void>, hooks: RunScriptHooks = {}): Promise<void> {
  const setExitCode = hooks.setExitCode ?? ((code: number) => (process.exitCode = code));
  const logError = hooks.logError ?? console.error;
  try {
    await body();
  } catch (error) {
    logError(`${name}: failed`, error);
    reporter.captureException(error);
    setExitCode(1);
  } finally {
    await reporter.flush(SCRIPT_FLUSH_TIMEOUT_MS);
  }
}
