# ADR draft: which company owns, sells, registers and signs (2026-11-26)

**Not yet in DECISIONS.md.** The number is set at merge; ADR-284 and ADR-285 are taken (Starter), so this is **ADR-286** and the jurisdiction-pack ADR in `jurisdiction-packs.md` is **ADR-287**. Basel's statements are recorded as given; the accountant's and lawyer's confirmations are listed as open points. Ticket: MUT-700 (rewritten 2026-11-26), with MUT-355, MUT-748, MUT-749, MUT-750.

---

## ADR-286: Barmajiyat Ltd Owns the IP and Sells the Subscription; Narabnd Studio Ltd Is the Registered Software House and Signer (MUT-700; amends ADR-265 and the billing ADR-160's VAT wording)

**Status:** Proposed (Basel's decisions, 2026-11-26; accept after the accountant and the lawyer confirm the open points). Supersedes the 2026-11-22 wording of MUT-700, which had Narabnd as owner and seller and proposed a new payment provider.

**Context:**
- Two companies, each 100% Basel's: **Barmajiyat Ltd** (UK) and **Narabnd Studio Ltd** (Israel, ח.פ. 517108775).
- Basel: Barmajiyat Ltd is an **Israeli tax resident** for this purpose, because an Israeli resident controls it fully; **Israeli VAT applies** to its subscriptions to Israeli businesses and consumers. Narabnd can register as the software house. The intercompany licence is priced at **cost + 5%** (transfer pricing).
- Issuing in Israel needs a registered software house, an API organization for the Tax Authority (SHAAM) and a signer for issued PDFs (ADR-260, ADR-264, ADR-265). The 2026-11-22 drafts had assumed Barmajiyat for the signer and Narabnd for ownership in different places.
- Stripe doesn't onboard Israeli companies (to be verified), and the product is already sold through Barmajiyat's Stripe account.

**Decision:**
1. **Roles.**
   - *Barmajiyat Ltd:* owns the IP and code; is the **seller of record of subscriptions** on **Stripe**; holds the store accounts (publisher) and the cloud billing; is an issuer in MTB3A for its own subscription invoices (MUT-639).
   - *Narabnd Studio Ltd:* the **Tax Authority software house** (registration, MUT-567), the **Open API organization and SHAAM security appendix** (MUT-638, MUT-710) and the **signer** of issued PDFs (MUT-641). It operates the Israeli service under a licence from Barmajiyat.
   - *Basel personally:* none of these roles.
2. **Israeli VAT on subscriptions.** Prices are advertised **excluding VAT**. At checkout, **18% Israeli VAT is added only for a customer with an address in Israel**; no one else has VAT added by us. The rate is one configuration value, not a literal in billing code. Stripe Tax is not relied on for Israel.
3. **Israeli tax documents for subscribers.** Barmajiyat Ltd is registered as an Israeli licensed dealer (MUT-749) and issues an Israeli tax invoice-receipt through MTB3A for each Stripe payment from an Israeli customer, with an allocation number where the threshold applies. A Stripe-hosted invoice is not the tax document.
4. **Signing.** The production document-signing certificate is issued to **Narabnd Studio Ltd, company number 517108775** (amends ADR-265's context, "the software house (Barmajiyat) signs", and decision 6's interim certificate "in Barmajiyat's name"). The PDF's reason line names the business whose document it is, as now.
5. **Licence and fee.** A written licence from Barmajiyat to Narabnd (IP stays with Barmajiyat) and an intercompany fee at **cost + 5%**, set up with the accountant (MUT-748).
6. **Terms and privacy.** The terms keep Barmajiyat Ltd as the party to the subscription. Whether Narabnd is also named (software house, and processor or controller for issued documents) is the lawyer's answer. The 2026-11-25 drafts (MUT-732) were written for Narabnd as the party and are reconciled before publication.
7. **Configuration, not code.** The software-house name and number (`software_house_*` in `production.tfvars`), the seller's details and the VAT rate are configuration, so a change of entity changes configuration only.

**Consequences:**
- The signing certificate command in `docs/operations/before-release.md` changes to Narabnd's name and number; the production certificate stays on hold until that is done.
- Billing and pricing documents (`pilot-offer.md`, `billing-spike.md`, `mut-362`, `hosted-request-reply.md`) say "excluding VAT; Israeli VAT added at checkout for Israeli addresses"; the old "UK seller, no VAT" reading is retired.
- Barmajiyat needs an Israeli VAT file and filings (MUT-749) before the first paid Israeli invoice. MUT-639 gates on the accountant's answer about issuing with software not yet registered.
- Two related Israeli companies means transfer-pricing and VAT treatment between them (MUT-748).

**Open points (accountant or lawyer):**
- Written confirmation that Barmajiyat Ltd is an Israeli tax resident, and whether it also owes UK corporation tax or files in the UK; UK VAT registration.
- Whether showing consumer prices excluding VAT is allowed in Israel (it may need to include VAT for consumers).
- What counts as an "Israeli address" at checkout (billing address, card country, tax ID).
- Invoice contents for subscribers; VAT for EU and Gulf customers of an Israeli-resident seller.
- Whether Barmajiyat may issue its own invoices with software not yet registered (MUT-639).

**Alternatives rejected:**
- Narabnd as owner and seller (the 2026-11-22 version): moves the IP away from Barmajiyat and needs an Israeli payment provider.
- Basel personally as the software house: puts the security obligations and liability on a person.
- Barmajiyat Ltd as the registrant: it is not confirmed that a UK company can register; Narabnd can.
- Relying on Stripe Tax for Israel: not supported when checked.

**Overrides (log):** ADR-265 context and decision 6 (signer entity); billing ADR-160 and the pilot-offer VAT wording (Israeli VAT applies); MUT-700's 2026-11-22 owner-and-seller decision.
