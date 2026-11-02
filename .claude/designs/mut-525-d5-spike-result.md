# MUT-525 D5 spike result (2026-11-02)

`node qa/support/mut525-coupon-spike.mjs` in the Mutaba3a Stripe sandbox, on test clocks: a yearly ILS subscription
(`freelancer_list_yearly_ils`, ₪290) with a 50% coupon restricted to the Freelancer product, with and without a
carried 10-day trial; the clock advanced past the trial and past the first renewal. Totals in agorot:

| Coupon shape | Trial carried | Invoices | First paid | Renewal | Result |
|---|---|---|---|---|---|
| `once` | yes | 0 (trial) → 14500 → 29000 | 14500 | 29000 | PASS |
| `once` | no | 14500 → 29000 | 14500 | 29000 | PASS |
| `repeating`, 12 months | yes | 0 (trial) → 14500 → 29000 | 14500 | 29000 | PASS |
| `repeating`, 12 months | no | 14500 → 29000 | 14500 | 29000 | PASS |

A `once` coupon is **not** spent on the ₪0 trial invoice: Stripe applies it to the first invoice with an amount.
After that invoice the subscription carries no discount (`discounts: []`); a `repeating` one still shows it until
its 12 months end. The plan's primary shape stands: **`duration: once`** (D1). The R2 gate is passed.
