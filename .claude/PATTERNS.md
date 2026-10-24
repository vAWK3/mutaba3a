

## Patterns added by MUT-291 (2026-10-24, ADR-181)

### Pattern: Replay untrusted records through the server's own routes in a throwaway app, then land them in one write
Imported data is never written field by field into the live store. It is mapped to requests and sent through `createLocalApp` over a fresh `MemoryLedgerStore`, with no persistence and no rate limit, so every route rule checks it. Its snapshot is then checked against the source and written once with `applyRestore`. A 4xx is the record's answer and gets listed; a 5xx aborts.

### Pattern: A cross-origin hand-off is a popup opened from the click, with origins baked at build time
`window.open` runs synchronously in the click handler (Safari and Firefox drop the permission across an await), without `noopener`. Both sides check `event.origin` and `event.source` against build-time origins, never against a URL parameter, and each side has its own timeout. Neither page may send COOP `same-origin`; a test pins that.
