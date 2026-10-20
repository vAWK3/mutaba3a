# Pending work: paused 2026-10-20 to free disk

Everything that was in flight on 2026-10-20 is in two places. Nothing here is pushed.

| Repo | Worktree | Branch |
|---|---|---|
| mini-crm | `mini-crm/.claude/worktrees/mut-298-firm-books` (this one) | `pending/2026-10-20` |
| mutaba3a-flutter | `mutaba3a-flutter/mutaba3a/.claude/worktrees/happy-ramanujan-407175` | `fix/mut-276-outbox-owner` |

Before resuming, free space must be **≥ 20 GB**: `df -g / | awk 'NR==2 {print $4}'`. iOS flows run only on the shared **"Mutaba3a QA"** simulator; wait if another run holds it.

---

## mini-crm: `pending/2026-10-20`

This branch was cut from local main at `7f364e01`. Merged into it, in order:

1. **MUT-338, animated save feedback** (`feature/mut-338-save-feedback`, head `2db00030`, already caught up with main). ADR-158.
2. **MUT-300, firm switch** (`feature/mut-300-firm-flag`, head `8c2ad84e`). Main had been merged into it once (`24430831`). The only conflict here was `.claude/CHANGELOG.md`; both entries were kept.
3. **MUT-358, billing core plan draft** (`.claude/designs/mut-358-billing-core.md`), commit `4d35d1ed`. Unfinished. The MUT-332 session started it on its own; it's rescued here.

The original branches `feature/mut-300-firm-flag` and `feature/mut-338-save-feedback` still exist as rollback points. Delete them once this branch lands.

### Status 2026-10-20 (late): MUT-300 and MUT-338 are finished; only MUT-358 is left here

- Main was merged in again (`e6a7e5b3`, plus `6ad9ba78`).
- Fixed: the firm block no longer reaches Malafat's `/v1/integration` (`93d891ad`). MUT-300's TD-183 is renumbered TD-192 (`3e505fb0`).
- Every gate passed on Node 22: web 5689 tests, server tests, and test:db. test:db's one failure was the known backfill-vs-parity cross-test flake (both tests are from main); it passes alone.
- Release-QA, all on preview builds at `3e505fb0`, all passing: the 2 MUT-300 features, 7 MUT-338 portal features and 2 MUT-338 web features.
- Landed with `git merge --no-ff pending/2026-10-20` into local main (not pushed). Steps 1–3 and 5 below are done for MUT-300 and MUT-338; step 4 (MUT-358) is still open.

### To finish (original steps)

1. **Install and check** (nothing ran after the combining merge):
   ```bash
   npm ci && (cd server && npm ci)
   npm run lint && npm run typecheck && npm run test:run && npm run build
   (cd server && npm run lint && npm run typecheck && npm test && npm run test:db)
   ```
2. **MUT-300 firm switch.**
   - Its own checks and its two release-QA features (`portal.profiles.firm-request`, `portal.shell.firm-enabled-banner`) passed on its branch before the pause.
   - It stopped only because of the disk gate. Re-run those two features here, because MUT-338 is now underneath.
   - Then merge into main and move Jira MUT-300 → In Review. MUT-299 (the brief) can go to Done.
   - **Migration:** MUT-300 adds firm columns and `Membership.role`. Run `npx prisma migrate status` against a fresh test DB, and check its migration folder sorts after main's newest.
3. **MUT-338 animated save feedback.**
   - Its 5 QA flows passed on its branch, but its specs only check that the icon is visible.
   - Run `/qa-reconcile MUT-338`, merge, then move Jira → In Review.
   - The Flutter half is MUT-351 (Backlog).
4. **MUT-358 billing core:** the plan waits for Basel to approve P1–P3 (§7 of the draft). Then `/eng-ticket MUT-358` → `/eng-build`. It blocks MUT-360..364.
5. **Land:** from the main checkout, `git merge --no-ff pending/2026-10-20`. Don't push; the MUT-329 release does that. Then remove this worktree:
   ```bash
   git worktree remove .claude/worktrees/mut-298-firm-books
   ```

---

## mutaba3a-flutter: `fix/mut-276-outbox-owner`

**MUT-276: outbox rows carry their owner** (GA gate). Jira: In Progress.

- `60d5af3e`: the fix. Outbox rows carry their owner, and another account on the same phone neither sees nor sends them. The brief is `.claude/designs/MUT-276-outbox-owner.md`.
- `8e9ce6d4`: **WIP** test updates across 13 files. These haven't been verified.
- **Where it paused:** QA on the simulator showed failures in the terms/settings/account-tab flows (showing `lang=ar`). They looked unrelated to MUT-276, and the session was comparing them against a clean main baseline.

### To finish

1. `flutter pub get && flutter test`, and fix whatever the WIP commit left red.
2. Settle the terms/settings/account-tab failures:
   - If they also fail on clean main, they're not MUT-276's. File a bug.
   - The likely cause is MUT-356's `?lang` on `/privacy`, or MUT-344's flows.
3. Write the MUT-276 QA flow and its catalog entry. The scenario: qa@ queues an entry offline, signs out, a second QA account signs in and neither sees nor sends it, then qa@ signs back in and it uploads. Run it on "Mutaba3a QA" until it passes, then run `release-qa lint`.
4. Decide whether MUT-215 ("only upload the signed-in user's queued entries") is covered by this fix, and close or keep it.
5. Merge into main (`--no-ff`, not pushed), move Jira → In Review, and remove the worktree.

---

## Already done, nothing pending

- **MUT-331** (signup, ADR-159) and **MUT-332** (billing, ADR-160) are on mini-crm main and Done. Their build stories are filed: MUT-358..371.
- **The pilot gate** is complete except Basel's steps: pick the apex domain, run the release (MUT-329 checklist, comments 12250/12254), apply Sentry (MUT-147), run the restore drill (MUT-327), and get the VAT rate (MUT-355).
