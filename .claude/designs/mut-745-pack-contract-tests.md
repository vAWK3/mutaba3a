# MUT-745 test plan

- `jurisdictions/__tests__/pack.contract.test.ts`: fixtures ⇔ registered packs; each `PACK_CHECKS` entry empty for every registered pack; each pack equals its fixture (identity, document types and code order, VAT on dated edges, the whole dealer table, refusal reason, languages, tax ID mask and numbers, per-line exemption, clearance kind, statutory file, dated table names); 28 broken Israel variants each fail their named check; every check proven.
- `jurisdictions/__tests__/golden.test.ts`: per pack, the fixture's composed-document hashes and statutory-file bytes.
- `jurisdictions/__tests__/il-pack.contract.test.ts`: Israel-only (codes, `DOC_TYPE_RANK`) and the registry.
- `jurisdictions/__tests__/boundary.test.ts`: any pack directory, Israel's allowlist, self-test with another pack.
- `__tests__/routes-pack-contract.test.ts`: per pack, through the routes: stamp, numbering, retry, sums, immutability, clearance failure.
- Regression: no assertion of the three original files weakened (each moved value is in the Israel fixture, compared at least as strictly).
