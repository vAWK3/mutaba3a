# Mutaba3a hosted pilot: weekly reviews

> MUT-330, epic MUT-322. **Every Monday, written, no meeting.** About 15 minutes.
> The bars and how each number is taken: `pilot-metrics.md`.

## How to write one

1. **Run the operator count** (`server/DEPLOYMENT.md` §6a) with `as_of` left at `now`. It's read-only, and the output is never sent anywhere (ADR-024).
2. **Check PostHog dashboard 1031822.** It's opt-in only, so it undercounts. Note only what disagrees with the operator count.
3. **Check Stripe** for unpaid or failed invoices, and **the support inbox** for new tickets.
4. **Add one dated section** at the top of the log below, copied from the template.

**Never write an email, a name or a profile name here.** This file is in the repository. Use the pilot codes (`P01`…`P10`) from the runbook.

**A user is at risk when any of these is true:**
- not activated, and setup was 5 or more days ago;
- no entry in the last 7 days;
- an invoice is unpaid or a payment failed;
- a ticket has waited longer than 2 working days for a reply;
- they said they might leave.

## Template

```markdown
## YYYY-MM-DD (pilot week N of 13)

**Numbers**

| Measure | This week | Bar at pilot end |
|---|---|---|
| Activated (first entry within 7 days of setup) | x / 10 | ≥ 8 / 10 |
| Entries in 3+ of the last 4 weeks | x / 10 | ≥ 6 / 10 |
| Paying (no unpaid invoice, hasn't asked to leave) | x / 10 | ≥ 7 / 10 at month 3 |
| Support tickets per user per week, last 4 weeks | x.xx | ≤ 0.5 |
| PostHog 1031822 (opt-in only) | what disagrees, or "agrees" | |

**Users at risk**
- P0x: why, in one line.

**One action**
- What, who, by when. Only one.
```

## Log

Newest first. No reviews yet: the first one is due on the first Monday after the first pilot user is onboarded.
