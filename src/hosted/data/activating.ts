/**
 * MUT-768 (accountant channel, DR-5, B15): "Activating" is the portal's own state, not the server's. When the
 * accountant is sent to Stripe for a customer, that customer is marked here; the desk shows Activating and re-reads the
 * list for two minutes (or until it says paid). A browser-storage convenience (sessionStorage): without it the row
 * simply reads Needs card until the list says paid.
 */
const KEY = 'mtb3a.desk.activating';
export const ACTIVATING_WINDOW_MS = 2 * 60_000;

type Marks = Record<string, number>;

function read(): Marks {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
  } catch {
    return {};
  }
}

function write(marks: Marks): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(marks));
  } catch {
    // Storage blocked or full: the row reads Needs card until the list says paid.
  }
}

export function markActivating(userId: string, now = Date.now()): void {
  write({ ...read(), [userId]: now });
}

export function clearActivating(userId: string): void {
  const { [userId]: _gone, ...rest } = read();
  write(rest);
}

/** The customers sent to Stripe within the last two minutes. */
export function activatingIds(now = Date.now()): Set<string> {
  return new Set(Object.entries(read()).flatMap(([id, at]) => (now - at < ACTIVATING_WINDOW_MS ? [id] : [])));
}

/** Sent to Stripe longer ago than the window: the desk says "Check back shortly" for them. */
export function lapsedActivationIds(now = Date.now()): Set<string> {
  return new Set(Object.entries(read()).flatMap(([id, at]) => (now - at >= ACTIVATING_WINDOW_MS ? [id] : [])));
}
