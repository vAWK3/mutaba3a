# Mail art (MUT-467, epic MUT-466)

PNG @2x art for the transactional mails, exported from the Claude Design mail kit
(MUT-467) and copied here byte-identical. Nothing reads these files yet: MUT-468
ships them on the website host as static, versioned PNGs (the same URL for every
recipient, no query string) and the mail frame in
`server/src/email/templates/layout.ts` points at them.

Every file is fully opaque on its group's tint (an alpha channel is present but
unused), so dark-mode mail apps show no holes. The largest is 18 KB.

## Mood groups

| Group | Tint | Mails |
|---|---|---|
| `hello` | peach | finish-signup, finish-setup, account-under-review, account-ready, welcome |
| `safety` | lavender | reset-password, password-changed, passkey-added, account-exists |
| `trial` | blue-grey | trial-ending-soon, trial-ended, trial-locking-soon |
| `goodbye` | warm grey | account-declined, account-closing |

The operator review digest stays plain.

## Files

- `mail-header-<group>-<art>-2x.png`: the header illustration, 320×320 (onboarding
  400×400), shown at half size.
- `chip-<icon>-<group>-2x.png`: an 80×80 round icon chip on a cream square, shown at
  40×40. The square matches the card surface, so a chip belongs on the white card,
  not on a tinted panel.
- `-rtl-` marks the mirrored copy for Arabic mails. Only art with a direction has one:
  onboarding, milestone-firm, destructive-confirmation, and the attach and insights
  chips.

Proposed header per mail (MUT-468 confirms):

| Mail | Header |
|---|---|
| welcome | `hello-onboarding` |
| finish-signup, finish-setup | `hello-spot-email` |
| account-under-review | `hello-spot-pending` |
| account-ready | `hello-milestone-firm` |
| reset-password, password-changed | `safety-spot-lock` |
| passkey-added | `safety-spot-badge` |
| account-exists | `safety-spot-person` |
| trial-ending-soon | `trial-spot-calendar` |
| trial-ended | `trial-spot-lock` |
| trial-locking-soon | `trial-spot-schedule` |
| account-declined | `goodbye-empty-state` |
| account-closing | `goodbye-destructive-confirmation` |

## Still missing (MUT-467)

- A `hello`-tinted client chip for the welcome's "add a client" step (the only person
  chip is `safety`).
- The official App Store and Google Play badges for the welcome mail. Use Apple's and
  Google's badge files, never a redrawn badge.
- The approved frame mockup (HTML or the Claude Design project link) that MUT-468
  builds from.
