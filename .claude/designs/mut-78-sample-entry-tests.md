# MUT-78 — Visitor sample entry: test plan

- **Ticket:** MUT-78 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` L8, findings F13–F15 · **ADR:** ADR-042
- **Files:** `src/demo/__tests__/visitorSample.test.ts` (fake-indexeddb), `src/demo/__tests__/seedDates.test.ts`, `src/components/ui/__tests__/SampleDataBar.test.tsx`, `src/components/modals/__tests__/WelcomeModal.sample.test.tsx`

## Rules under test

| # | Rule | Level |
|---|---|---|
| T1 | `enterVisitorSample` on an empty database seeds the sample, picks the sample business with the most clients owing, records a session, and returns `{ kind: 'sample', profileId }` | integration (Dexie) |
| T2 | A second entry with a live session does not re-seed (row counts unchanged) and returns the same profile | integration |
| T3 | A database with the person's own data (any non-`demo_` profile, client, entry or expense) is never touched: `{ kind: 'own-data' }`, no `demo_` rows written, no session | integration |
| T4 | Seeding for a visitor leaves no "Switched on for your existing data" notice, and records which areas it switched on | integration |
| T5 | `leaveVisitorSample` removes every `demo_` row, every row created during the session (clients, projects, entries, payment records, expenses, profiles), switches off exactly the areas the sample switched on, and clears the session | integration |
| T6 | Rows older than the session (e.g. a restored backup) survive `leaveVisitorSample` | integration |
| T7 | `countSessionAdditions` counts what the visitor added during the session, and only that | integration |
| T8 | The seed never writes a payment date or expense date after today, and only one profile is Default after seeding into a database that already has a default | unit |
| T9 | `SampleDataBar`: shows the sample message; "Start with your own" with nothing added leaves at once; with additions it asks first, naming the count, and "Keep looking" cancels | component |
| T10 | `WelcomeModal` stays closed while the sample is being prepared | component |

## Edge cases

- Session flag present but the sample rows are gone (e.g. internal reset) → the session is cleared and the entry seeds again.
- Seeding fails → status returns to `none`, no session, the app opens normally.
