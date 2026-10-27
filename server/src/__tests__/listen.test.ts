import type { AddressInfo } from 'node:net';
import { connect, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { ServerType } from '@hono/node-server';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../listen.js';

/**
 * MUT-463: real sockets through the same startServer index.ts uses. Port 0 lets the OS pick, so parallel files never
 * race for one. The only wildcard bind here is the unset case, and it never dials the LAN address (review D5).
 */
const answer = () => new Response('ok');
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((iface) => iface?.family === 'IPv4' && !iface.internal)?.address;

const servers: ServerType[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

function listening(HOST?: string): Promise<AddressInfo> {
  return new Promise((resolve) => {
    servers.push(startServer(answer, { PORT: 0, ...(HOST ? { HOST } : {}) }, resolve));
  });
}

/** Where Node binds when it is given no hostname: `::` on a dual-stack machine, `0.0.0.0` without IPv6. */
function nodeDefaultAddress(): Promise<string> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, () => {
      const { address } = probe.address() as AddressInfo;
      probe.close(() => resolve(address));
    });
  });
}

function dial(port: number, host: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, host);
    // An interface that drops packets (VPN, firewall) fails fast as 'timeout' instead of hanging the suite.
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve('timeout');
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
  });
}

describe('startServer — listen address (MUT-463)', () => {
  it('with HOST=127.0.0.1, listens on 127.0.0.1 and answers there', async () => {
    const { address, port } = await listening('127.0.0.1');
    expect(address).toBe('127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it.skipIf(!lanAddress)('with HOST=127.0.0.1, refuses connections on the LAN address (skipped without one)', async () => {
    const { port } = await listening('127.0.0.1');
    expect(await dial(port, lanAddress!)).toBe('ECONNREFUSED');
  });

  it('with HOST unset, binds exactly where Node binds by default, so Cloud Run keeps IPv4 and IPv6', async () => {
    const expected = await nodeDefaultAddress();
    const { address } = await listening();
    expect(address).toBe(expected);
  });
});
