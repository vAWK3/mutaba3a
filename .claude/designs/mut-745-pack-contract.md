# MUT-745: a pack contract suite and per-pack golden fixtures

> Built under Basel's 2026-11-27 go-ahead (epic MUT-738, step 6 of `jurisdiction-packs.md`, approved; ADR-287). Tests
> plus one additive pack field. Defaults chosen conservatively. Not yet reviewed by Basel.

## Problem
Israel's rules were proven by Israel-only tests (`il-pack.contract.test.ts`, `golden.test.ts`, `boundary.test.ts`). A
second pack (ZATCA, JoFotara) would have nothing to pass, and the issuing behaviour the core promises (numbering,
idempotent retry, immutability, clearance, the stamp) was proven only under Israel.

## Acceptance criteria (ticket)
1. The IL pack passes the suite.
2. A deliberately broken fake pack fails it.
3. The release-QA feature map covers each live pack (`qa/features/portal/invoicing-<cc>.yaml`): **not done, see Open**.

## Design (built)
- **Fixture per pack** (`server/src/jurisdictions/__tests__/fixtures/<cc>.ts`, registered in `fixtures/index.ts`): the
  pack's rules written out by hand (`expected`), its golden documents and statutory-file bytes (`golden`), and what the
  route contract issues with (`route`, plus a clearance failure when the pack clears). Every registered pack must have
  one and every fixture a pack. Israel's fixture holds exactly what `il-pack.contract.test.ts` and `golden.test.ts`
  asserted before, unchanged (hashes included); the dealer table is now compared whole (stronger than before).
- **Contract checker** (`__tests__/pack-contract.ts`, pure): `PACK_CHECKS` — fixture present; identity (ISO country,
  x.y.z version, IANA zone, ISO currencies, base among issuing, retention ≥ 1); document types (every core type, unique
  positive codes); dealers (one table: `issues` ⇔ the refusal rule, default and entry types issuable, label keys
  `<cc>.<value>`, exemption agrees); languages (core list, default available); tax IDs (scheme, mask compiles, the
  fixture's valid/invalid numbers); **dated rules** (a `vat.standardRate` table; every dated table ascending, with a step
  in force on today's date in the pack's zone; today's VAT a whole 0–10000 bp); documents (every type each dealer
  issues composes; Σ line nets = subtotal, subtotal − discount = net, Σ line VAT = VAT, net + VAT = gross, the pack's
  rate; refused pairs don't compose); hooks (expense rule answers, clearance/statutory file named).
- **Broken packs:** 28 mutations of the Israel pack, each failing its named check; a test fails if any check has no
  broken pack proving it.
- **Route contract** (`server/src/__tests__/routes-pack-contract.test.ts`), for every registered pack through the real
  routes: the stamp (document, issuer snapshot, audit), numbers 1-2-3 with no gaps, an idempotent retry taking no
  number, lines adding up on the issued document, no PATCH/PUT/DELETE, and (packs with clearance) a refused clearance
  leaving no document, no audit entry and no number taken.
- **Boundary guard** generalised: core code may import no pack directory (`jurisdictions/<cc>/**`), not only Israel's;
  Israel's allowlist is unchanged and still checked against Israel's imports.
- **Pack field:** `JurisdictionPack.datedTables` (name + step start dates). Israel declares `vat.standardRate` and
  `expense.allocationThreshold`. Not in the rules read; no API change; pack version stays 1.0.0 (no rule changed).
- **Review date per pack:** `docs/operations/jurisdiction-packs.md`. Not a test: a date check would fail CI on a
  calendar day, not on a change.

## Not done / open
- **AC3, release-QA map per live pack.** The portal's invoicing specs run on a stubbed API (`FakeApi`), so no portal
  flow exercises a server pack. Making `invoicing-il.yaml` means moving the Israel-only features (uniform-file,
  uniform-file-empty, manual-allocation, starter-manual-allocation, starter-connect-refused, solo-automatic-allocation)
  out of `invoicing.yaml` and re-tagging their specs, which changes their fingerprints and forces re-recordings. Left
  for Basel / the QA owner to decide.
- **A PDF golden set** for Israel: issued PDFs are not byte-stable in the suite today (`issuing/pdf/__tests__/gate.test.ts`
  checks glyphs and text order instead). The uniform-file simulator fixture stays `src/__tests__/uniform-file-fixture.test.ts`.
- A route-level broken pack is not built: a pack cannot break the core's numbering or stamp; the core's own suites
  cover that, and the route contract proves it under every pack.

## Impact
Tests only, plus the additive `datedTables` field. No migration, no API change, no client change, no QA re-run.
