import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MUT-523 AC3: the old stack stays in me-west1 while the new one is in europe-west1, so neither Terraform stack may
 * name a region in its code: every location follows var.region, which has no default (a tfvars without `region` stops
 * at plan instead of quietly landing in a default), and config/gcp.json names each project's region for the scripts.
 * The tfvars examples are where a region is written down.
 */
const INFRA = resolve(process.cwd(), 'infrastructure');
const STACKS = ['terraform', 'frontdoor'];
const GCP_REGION = /\b(?:me|europe|us|asia|australia|northamerica|southamerica|africa)-[a-z]+\d+\b/;

const tfFiles = (stack: string) =>
  readdirSync(join(INFRA, stack))
    .filter((f) => f.endsWith('.tf'))
    .map((f) => join(INFRA, stack, f));

describe('no stack hardcodes a GCP region (MUT-523)', () => {
  it.each(STACKS)('%s: no .tf file names a GCP region', (stack) => {
    const hits = tfFiles(stack).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (GCP_REGION.test(line) ? [`${file.slice(INFRA.length + 1)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it.each(STACKS)('%s: var.region has no default', (stack) => {
    const vars = readFileSync(join(INFRA, stack, 'variables.tf'), 'utf8');
    const block = /variable "region" \{[\s\S]*?\n\}/.exec(vars)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).not.toMatch(/default\s*=/);
  });

  it('the new project\'s tfvars example is in europe-west1 on Barmajiyat Ltd\'s GBP billing account; the old one stays in me-west1', () => {
    const production = readFileSync(join(INFRA, 'terraform/production.tfvars.example'), 'utf8');
    expect(production).toMatch(/^region\s+= "europe-west1"$/m);
    expect(production).toMatch(/^billing_account_id\s+= "01E433-999491-75ECBD"$/m);
    expect(production).toMatch(/^budget_amount\s+= 25$/m);
    expect(production).toMatch(/^budget_currency\s+= "GBP"$/m);
    expect(readFileSync(join(INFRA, 'terraform/legacy.tfvars.example'), 'utf8')).toMatch(/^region\s+= "me-west1"$/m);
    expect(readFileSync(join(INFRA, 'frontdoor/production.tfvars.example'), 'utf8')).toMatch(/^region\s+= "europe-west1"$/m);
  });
});
