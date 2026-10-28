import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MUT-441 (R9): the receipt-ocr sidecar's network has no way out. tests/receipt_ocr.tftest.hcl asserts what exists
 * (ALL_TRAFFIC into its own subnet, no default route, a deny-all egress rule); `terraform test` can't assert that a
 * resource type is absent, so this reads every .tf file in the stack: no Cloud Router and no Cloud NAT anywhere, and
 * no route that would open the sidecar's network.
 */
const TF_DIR = resolve(process.cwd(), 'infrastructure/terraform');
const stack = readdirSync(TF_DIR)
  .filter((name) => name.endsWith('.tf'))
  .map((name) => ({ name, text: readFileSync(join(TF_DIR, name), 'utf8') }));
const resources = stack.flatMap(({ name, text }) =>
  [...text.matchAll(/^\s*resource\s+"([^"]+)"\s+"([^"]+)"/gm)].map((m) => ({ file: name, type: m[1]!, name: m[2]! })),
);

describe('receipt-ocr egress lock (R9)', () => {
  it('reads the stack (a renamed directory would make the checks below vacuous)', () => {
    expect(resources.map((r) => `${r.type}.${r.name}`)).toEqual(
      expect.arrayContaining(['google_cloud_run_v2_service.receipt_ocr', 'google_compute_network.receipt_ocr', 'google_compute_firewall.receipt_ocr_deny_egress']),
    );
  });

  it('has no Cloud Router, Cloud NAT or route resource anywhere in the stack', () => {
    expect(resources.filter((r) => /^google_compute_(router|router_nat|route|router_peer|router_interface)$/.test(r.type))).toEqual([]);
  });

  it('has no other firewall rule on the sidecar’s network that could allow egress', () => {
    const firewalls = resources.filter((r) => r.type === 'google_compute_firewall');
    expect(firewalls.map((r) => r.name)).toEqual(['receipt_ocr_deny_egress']);
  });
});
