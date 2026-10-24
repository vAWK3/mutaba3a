#!/usr/bin/env node
/**
 * MUT-291 (eng review R6): the `carry-over` QA app. The carry-over moves records between browser origins, so this
 * app runs three on one machine, all on the loopback:
 *
 *   - the free web app (the old app) on 127.0.0.1:5183;
 *   - the portal as the old address, on 127.0.0.1:5187;
 *   - the portal as the new address, on 127.0.0.1:5188 (the app's baseURL, started last).
 *
 * Each build is told these origins through MUTABA3A_CARRY_OVER, never config/hosts.json, so nothing here can name a
 * real host. The portals run with no API: every spec answers /v1 itself (signed out is a 401). Ports 5173-5178 belong
 * to the web, portal and other sessions' dev servers.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_PORT = 5183;
export const OLD_PORTAL_PORT = 5187;
export const NEW_PORTAL_PORT = 5188;
const HOST = '127.0.0.1';
const origin = (port) => `http://${HOST}:${port}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const CARRY_OVER = JSON.stringify({ web: origin(WEB_PORT), portal: origin(OLD_PORTAL_PORT), portalOrigin: origin(NEW_PORTAL_PORT) });
const children = [];

/** Each server's own Vite cache and watch settings (support/carry-over.vite.ts), or they reload each other's pages. */
const VITE_CONFIG = path.join('qa', 'support', 'carry-over.vite.ts');

function start(name, args, env) {
  const child = spawn('npx', ['vite', '--config', VITE_CONFIG, ...args, '--host', HOST, '--strictPort'], { cwd: ROOT, env: { ...process.env, MUTABA3A_CARRY_OVER: CARRY_OVER, ...env }, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code) => {
    console.error(`[carry-over] ${name} exited (${code ?? 'signal'})`);
    stop(1);
  });
  children.push(child);
}

function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, HOST);
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitFor(port) {
  for (let tries = 0; tries < 240; tries++) {
    if (await listening(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`[carry-over] nothing listened on ${port}`);
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start('web', ['--port', String(WEB_PORT)], { CARRY_OVER_ROLE: 'web' });
start('old portal', ['--mode', 'hosted', '--port', String(OLD_PORTAL_PORT)], { CARRY_OVER_ROLE: 'old-portal' });
await Promise.all([waitFor(WEB_PORT), waitFor(OLD_PORTAL_PORT)]);
// The engine waits on this one: once it answers, all three do.
start('new portal', ['--mode', 'hosted', '--port', String(NEW_PORTAL_PORT)], { CARRY_OVER_ROLE: 'new-portal' });
