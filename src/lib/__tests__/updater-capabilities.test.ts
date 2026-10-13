import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the Tauri ACL grants the updater needs (MUT-99).
 *
 * `tauri-plugin-updater` and `tauri-plugin-process` are registered in
 * `src-tauri/src/lib.rs` and configured in `tauri.conf.json`, but Tauri v2
 * blocks every plugin command at the capability layer unless the capability
 * file grants it — registering a plugin is not enough. Without `updater:default`,
 * `check()` fails "not allowed" before any network call ever happens; without
 * `process:allow-restart`, the post-install `relaunch()` fails the same way.
 * This is friction against a repeat: removing either grant breaks the updater
 * silently (no compile error, no lint warning) until someone runs it on a
 * release build.
 */

const CAPABILITIES_PATH = resolve(process.cwd(), 'src-tauri/capabilities/default.json');

type PermissionEntry = string | { identifier: string };

interface CapabilitiesConfig {
  permissions?: PermissionEntry[];
}

function loadCapabilities(): CapabilitiesConfig {
  return JSON.parse(readFileSync(CAPABILITIES_PATH, 'utf8')) as CapabilitiesConfig;
}

function grants(permissions: PermissionEntry[] | undefined, identifier: string): boolean {
  return (permissions ?? []).some((entry) =>
    typeof entry === 'string' ? entry === identifier : entry.identifier === identifier
  );
}

describe('src-tauri/capabilities/default.json updater grants', () => {
  it('grants updater:default, so check()/download/install are not "not allowed"', () => {
    const { permissions } = loadCapabilities();
    expect(
      grants(permissions, 'updater:default'),
      'capabilities/default.json must grant "updater:default" or the updater check fails before it reaches the network (MUT-99)'
    ).toBe(true);
  });

  it('grants process:allow-restart, so relaunch() after install is not "not allowed"', () => {
    const { permissions } = loadCapabilities();
    expect(
      grants(permissions, 'process:allow-restart'),
      'capabilities/default.json must grant "process:allow-restart" or relaunch() after an installed update fails (MUT-99)'
    ).toBe(true);
  });
});
