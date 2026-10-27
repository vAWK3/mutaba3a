import net from 'node:net';

const PROBE_TIMEOUT_MS = 1000;

function answers(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * MUT-463 (review D1): the QA APIs bind 127.0.0.1 only, so another server on the same port bound to :: or ::1 now
 * starts without "port in use", and `localhost` (::1 first) would reach it instead of ours. Refuse to start instead.
 */
export async function assertPortFree(port, label) {
  for (const host of ['::1', '127.0.0.1']) {
    if (await answers(host, port)) {
      throw new Error(`[${label}] something already listens on ${host === '::1' ? '[::1]' : host}:${port}; stop it, then retry`);
    }
  }
}
