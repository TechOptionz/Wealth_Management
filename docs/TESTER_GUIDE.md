# Holdfast — Tester's Guide

**What this document is for.** You are about to test Holdfast, a wealth and property
operations web app. Before you click anything, read this once. It explains what the
system is, the words it uses, the sample data you will see, and the rules it must
never break. Every term comes with an example taken from the real sample data, so
when you see it on screen you will recognise it.

**Version of the system described:** build of 27 September 2026 (318 automated
tests passing). **Sample data is frozen at:** 6 September 2026 (see §2.2).

---

## Contents

1. What Holdfast is
2. Before you start: how the test build behaves
3. The screens (menu map)
4. Glossary, by category
   - 4.1 People, ownership and legal structures
   - 4.2 Properties and valuations
   - 4.3 Loans and debt
   - 4.4 Tenants, leases and rent
   - 4.5 Bank import and matching
   - 4.6 Shared bills and recoveries
   - 4.7 Obligations and reminders
   - 4.8 Expenses
   - 4.9 Documents
   - 4.10 Dashboard, totals and reports
   - 4.11 Access, roles and the audit log
5. The sample world (the data you will be testing with)
6. What you can do on each screen
7. Rules the system must never break (and how to check each one)
8. Things that are not built yet (do not log these as bugs)
9. A suggested first walkthrough
10. Quick reference: addresses, commands, API, tests

---

## 1. What Holdfast is

Holdfast is a private web app for one family that owns several properties through
different legal structures: some personally, some through a family trust, some
through a company. It keeps one connected record of:

- **who owns what**, and through which structure;
- **what each property is worth**, and when it was last valued;
- **the loans** secured against those properties;
- **the tenants**, their leases, the rent they owe and what they have paid;
- **shared bills** (water, power, cleaning) and how much of each is recovered from
  tenants;
- **recurring obligations** such as insurance, council rates and safety
  certificates, with reminders;
- **bank statements**, matched line by line against rent and bills;
- **expenses and documents**, with a full history of changes;
- **who may see what**, and an audit log of everything that happened.

All of that rolls up into a **dashboard** that shows net worth, cash flow, rent
arrears and what is due soon, with a "explain this total" link that lists exactly
which records make up every number.

**Who uses it.** The family members who own the portfolio, a helper who manages the
properties day to day, an external accountant, and an IT operator. Each has a
different level of access (§4.11).

**What it is not.** It does not move money, pay anyone, send real emails, talk to a
bank, or give tax or legal advice. It records, calculates and reminds.

---

## 2. Before you start: how the test build behaves

### 2.1 There is no login. Use the persona switcher.

Real sign-in is not built. Instead, the avatar at the top-right of every screen opens
a small **"Test personas"** panel. Pick a person and the whole app behaves as if they
were signed in. The default is **Jawad Siddique** (Portfolio owner), who can see
everything. Switching is recorded in the audit log.

Use this to test permissions: switch to Mahvish Gull and confirm she cannot see net
worth; switch to A. Kumar and confirm they cannot confirm bank transactions. See §4.11
and §5.1 for what each person may do.

### 2.2 The clock is frozen at 6 September 2026

The app evaluates everything against an **as-of date**, and the test build pins it to
**6 September 2026**. So "today", "overdue", "due in the next 14 days", "stale",
"ending soon" and every other date-based status are measured from that date, not from
the real calendar. A bill due on 1 September 2026 is overdue; one due on 14 September
is due in 8 days.

If someone changes the `AS_OF_DATE` setting to `today`, the figures move and this
guide's expected numbers no longer apply.

### 2.3 Sample data, and whether your changes stick

The app starts with a built-in sample dataset (the Siddique family portfolio,
described in §5). There are two modes:

| Mode | When | What happens to your changes |
| --- | --- | --- |
| In-memory | No database configured | Everything you add or change is lost when the server restarts. Restart to get a clean slate. |
| Postgres | A `DATABASE_URL` is configured (this is the case in the current `.env.local` and on the hosted deployment) | Changes persist across restarts. `npm run db:reset` empties the tables so the next page load re-seeds the sample data. |

Tell the person who set up your environment which mode you are in, and agree on how
you will reset between test runs.

### 2.4 Things that are true everywhere

- **Money is Australian dollars.** Amounts are stored to the cent and never rounded
  in the middle of a calculation.
- **Every total carries a date.** If you see a figure with no date next to it, that
  is a defect.
- **Status is never colour alone.** Every status chip shows an icon and words as well
  as a colour. A chip that is only a coloured dot is a defect.
- **Nothing is deleted.** Records are corrected with a new version, voided, reversed
  or hidden. The history stays.
- **A missing number shows as "Unavailable", never as 0 or 0%.** If a ratio cannot be
  calculated honestly, the app says so.
- **Nothing is sent outside the app.** Reminders are recorded as queued, sent or
  failed, but no email or SMS actually leaves.
- **Forms validate on the server.** Errors appear next to the field, not as a crash.
  A form that returns an unhelpful "Something went wrong" is a defect.
- **The app is responsive.** At phone width the sidebar becomes a bottom tab bar and
  tables collapse into cards. Keyboard users can reach every clickable row with Tab
  and Enter.

### 2.5 Running it locally

```
npm install
npm run dev          # opens on http://localhost:3000
```

Optional checks a tester can run:

```
npm test             # 318 automated tests (5 need a test database and are skipped otherwise)
npm run typecheck
npm run lint
```

---

## 3. The screens (menu map)

The left sidebar is grouped. Some items show a **count badge** that is calculated
live from the data.

| Group | Screen | Address | What it is for | Badge |
| --- | --- | --- | --- | --- |
| Overview | Dashboard | `/dashboard` | Net worth, cash flow, arrears, what is due, what needs attention | — |
| Overview | Obligations & reminders | `/obligations` | Recurring and one-off things that must be paid or done, with reminders | Open obligations |
| Money | Bank import & matching | `/bank-import` | Import a bank statement and match each line to rent, a bill or an expense | Unmatched transactions |
| Money | Shared bills & recoveries | `/shared-bills` | Split a supplier bill between tenants and the owner | Bills needing review |
| Money | Expenses | `/expenses` | The expense register, with corrections and history | — |
| Money | Loans & liabilities | `/loans` | Every loan, its balance, rate, repayment and security | — |
| Property | Properties & assets | `/properties`, `/properties/<id>` | Each property, its valuation, rooms, tenants, debt | — |
| Property | Leases & tenants | `/leases` | Who rents what, for how much, and who is behind | — |
| Records | Entities & ownership | `/entities` | People, companies, trusts and who owns which property | — |
| Records | Documents | `/documents` | The document register and what each file is linked to | — |
| Admin | Access & audit | `/access` | People, roles, what each can see, and the audit log | — |
| Admin | Design system | `/design-system` | A reference page showing every UI component; not a business screen | — |

Other places to know about:

- **Explain this total** — `/explain/<metric>`: a drill-down page behind every
  dashboard figure. Metrics: `net-worth`, `assets`, `liabilities`, `arrears`,
  `upcoming-obligations`, `operating-expenses`.
- **Search** — the box in the top bar. Searches properties, tenants, obligations,
  loans and documents. Needs at least 2 characters. Choosing a result opens that
  exact record: a property opens its page; a tenant, obligation, loan or document
  opens its list screen with the record selected, highlighted and scrolled into
  view. Hidden on phone widths by design.
- **Notifications bell** — top bar. Lists overdue rent, overdue obligations,
  obligations due within 14 days, and one rolled-up line for unmatched bank rows.
- **Mobile tab bar** — Home, Money, Property, Tasks, More. Screens without their own
  tab light up "More".
- **JSON API** — every screen has a matching `/api/...` address returning the same
  data (§10.3). Useful for checking that the screen and the data agree.

---

## 4. Glossary, by category

Each table has three columns: the word, what it means in plain language, and an
example you can find in the sample data.

### 4.1 People, ownership and legal structures (screen: Entities & ownership)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Entity** | Anyone or anything that can own property or owe money: a person, a company, a trust or a super fund. | There are six: Jawad Siddique, Mahvish Gull, Hassan Siddique (people); Esteem Development Pty Ltd (company); Siddique Family Trust (trust); Siddique Superannuation Fund (SMSF). |
| **Individual** | A real person. | Jawad Siddique. |
| **Company** | A registered company. It can own property and borrow money in its own name. | Esteem Development Pty Ltd owns 20 Benton St and Lot 12 Logan Reserve. |
| **Trust** | A legal arrangement where a trustee holds assets for the benefit of others (the beneficiaries). | Siddique Family Trust owns 166 Compton Rd and Mians Rd. |
| **Corporate trustee** | A company acting as the trustee of a trust. | Esteem Development Pty Ltd is the trustee of the Siddique Family Trust. |
| **SMSF** | Self-managed super fund. In this release it is listed but its value is not counted. | Siddique Superannuation Fund shows "Not included yet". |
| **Relationship** | A dated link between an entity and a property or another entity. It has a start date and, if ended, an end date. Ended relationships are kept, not deleted. | "Siddique Family Trust owns 166 Compton Rd, 100%, from 12 Mar 2021." |
| **Ownership share** | The percentage of a property an entity owns. Only "owns" relationships carry a share. | Jawad 50% and Mahvish 50% of Watson Rd. |
| **Control relationship** | A relationship that gives influence but **no ownership share**: director of, trustee of, beneficiary of, member of, borrower of. The app refuses to attach a percentage to these. | Jawad is a beneficiary of the Family Trust. That does not give him a percentage of the trust's properties. |
| **Look-through consolidation** | The way the dashboard adds things up: it looks *through* each company or trust to the properties it holds and counts each property **once**, at the owner's share. It never adds a company's value on top of the properties the company already holds. | 166 Compton Rd is counted once at $1,180,000 under the Family Trust, even though the trust, the trustee company and three beneficiaries are all connected to it. |
| **Manual summary / not included** | An entity whose value is entered by hand later and is left out of totals for now. | The SMSF. |
| **Holdings** | An entity's own balance sheet: the properties it holds (at its share) less the debt it borrowed. | Esteem Development: Benton St + Logan Reserve, less the CBA loan. |

### 4.2 Properties and valuations (screen: Properties & assets)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Property** | A single real-estate asset. It is the thing counted once in net worth. | Five: 166 Compton Rd Woodridge, 20 Benton St Acacia Ridge, Watson Rd Acacia Ridge, Mians Rd Woodridge, Lot 12 Logan Reserve. |
| **Property status** | One of: Rented, Own home, Vacant, Under construction. | Compton Rd and Benton St are Rented; Watson Rd is Own home; Mians Rd is Vacant; Logan Reserve is Under construction. |
| **Rental mode** | How the property earns rent: By room, Whole property, or Not rented. | Compton Rd is let by room (6 rooms). Benton St is let whole. |
| **Component / Room** | A part of a property that can be leased separately. A room is never an asset in its own right and never has its own valuation. | Compton Rd has Room 1 to Room 6. Room 6 has been vacant since 24 Aug 2026. |
| **Valuation** | A dated statement of what a property is worth, with a source (basis) and a confidence. The latest one on or before the as-of date is used. | Compton Rd: $1,180,000, bank valuation, 18 Aug 2026, high confidence. |
| **Valuation basis** | Where the figure came from: Bank valuation, Agent appraisal, Purchase price, or At cost (build cost so far). | Mians Rd is still carried at its 2023 purchase price of $760,000. Logan Reserve is at cost, $318,000. |
| **Confidence** | High, Medium or Low, as recorded by whoever entered it. | The Benton St agent appraisal is Medium. |
| **Stale valuation** | A valuation older than 12 months at the as-of date. It is still shown (the asset does not disappear) but is flagged and must not be used in ratios. | Benton St's last valuation is an agent appraisal from 10 Jun 2025, about 15 months old, so it is stale. |
| **Eligible for ratios** | Only a Bank valuation or Agent appraisal that is not stale may be used to calculate a loan-to-value ratio. Purchase price and at-cost are never eligible, however recent. | Compton Rd (Aug 2026 bank) is eligible; Mians Rd (purchase price) is not. |
| **Purchase price and settlement costs** | What was paid for the property and the costs of buying it (stamp duty, legal fees). | Compton Rd: $812,000 plus $34,500 settlement costs. |
| **Capital growth** | Latest valuation minus (purchase price + settlement costs). Calculated on the fly; never stored. Blank if either input is missing. | Compton Rd: $1,180,000 − ($812,000 + $34,500) = $333,500. |
| **Ownership label** | The plain-words summary of who owns the property. | "Jawad & Mahvish · 50/50" on Watson Rd. |
| **Consolidation method chosen** | Whether the family has decided how a property should be counted. Watson Rd is jointly held and the decision is still open, so it is flagged. | Watson Rd shows the flag; the other four do not. |
| **Ownership gap** | A property whose recorded owners add up to less than 100%. The missing share is simply not counted. | None in the sample data; create a property with one 50% owner to see it. |

### 4.3 Loans and debt (screen: Loans & liabilities)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Loan / facility** | A borrowing arrangement with a lender. | Macquarie Home loan 4417, CBA Investment loan 8820, ANZ Investment loan 3305. |
| **Liability** | Money the family owes. Counted in "Liabilities" and subtracted from net worth. | The three bank loans, total $2,206,700. |
| **Receivable** | Money the family has **lent out** and is owed back. It is an **asset**, never a debt and never an expense. | Personal loan to S. Khalid, $120,000. It appears under Assets. |
| **Borrower** | The entity that owes the money. Debt is attributed to the borrower(s). | The ANZ loan's borrower is the Siddique Family Trust. |
| **Balance as-of date** | The date the balance was last confirmed from a statement. Shown next to every balance. | Macquarie: $612,400 as of 31 Aug 2026. |
| **Interest rate: fixed / variable** | Whether the rate is locked for a period or can move. A fixed rate has a "fixed until" date. | Macquarie is fixed at 5.89% until 30 Sep 2026. CBA is variable at 6.34%. |
| **Rate review date** | When the rate should be looked at again. Also appears as an obligation. | Macquarie: 30 Sep 2026 ("Loan rate review" obligation). |
| **Repayment type** | P&I = principal and interest (the balance goes down). IO = interest only (the balance stays the same). Custom = anything else. | Macquarie is P&I ($3,860 a month, of which $854 is principal). CBA is IO ($6,250 a month, all interest). |
| **Security** | The property or properties the lender can claim if the loan is not repaid. Single (one property), Pool (several), or Unsecured. | Macquarie is secured by Watson Rd alone. The Khalid loan is unsecured. |
| **Cross-collateralised / pool** | One loan secured by several properties at once. | CBA 8820 is secured by Compton Rd **and** Benton St together. |
| **Allocation policy** | The rule for how a pooled loan's debt is split across its properties. It must be **approved** before any per-property ratio is published. | CBA 8820 has a 50/50 policy that is **not approved**, so per-property LVR is withheld ("Pool only · allocation policy needed"). |
| **LVR (loan-to-value ratio)** | Debt divided by the eligible value of the security. A common lender measure. | Watson Rd: $612,400 ÷ $1,052,000 ≈ 58.2%. |
| **Unavailable** | What the app shows instead of a ratio it cannot calculate honestly (stale or ineligible valuation, unapproved policy). It never shows 0%. | Mians Rd LVR is Unavailable because its only valuation is a purchase price. The CBA pool LVR is Unavailable because Benton St's valuation is stale. |
| **Principal / interest split** | How much of each repayment reduces the balance and how much is interest. Recorded from the statement. For a new loan the app uses a working estimate until a statement is entered. | ANZ: $1,830 a month, currently all interest. |

### 4.4 Tenants, leases and rent (screen: Leases & tenants)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Tenant** | A person renting a room or a whole property. | Six current: L. Okafor, M. Chen, A. Nguyen, S. Williams, D. Rahman, R. Patel. Six former tenants are also kept on record. |
| **Lease** | The agreement: tenant, property (and room), start and end dates, rent, how often it is charged. | A. Nguyen, Room 3 at Compton Rd, 1 Jun 2026 to 31 May 2027, $500 a fortnight. |
| **Lease reference** | A short code for the lease. Bank receipts that quote it are matched automatically. | `166C-R3` (Compton Rd, Room 3). `20B-WH` (Benton St, whole). References ending in `-P` are previous, ended leases. |
| **Rent frequency** | Weekly, Fortnightly or Monthly. | Okafor pays weekly; Nguyen pays fortnightly. |
| **Charge anchor date** | The day rent is charged, which is often not the day the lease started. All future charges step from it. | Patel's lease started 1 Nov 2025 but rent is charged from 4 Nov. |
| **Rent charge** | One instalment of rent that has become due. Charges are generated from the lease when it is created. | Nguyen: $500 due 25 Aug 2026. |
| **Receipt / allocation** | A payment applied against a charge. A receipt from a bank import carries the bank transaction ID. | $300 received 28 Aug 2026, allocated to Nguyen's 25 Aug charge. |
| **Partial payment** | A receipt smaller than the charge. The remainder stays owing. | Nguyen paid $300 of $500, so $200 remains. |
| **Paid ahead (credit)** | A receipt larger than what is due. The excess is credit, not arrears. | S. Williams paid $680 against a $340 charge: $340 paid ahead. |
| **Arrears** | Rent that is due on or before the as-of date and has not been paid. **Calculated every time**, never stored: due charges − receipts − approved credits, adjusted for reversals. Rent due in the future is not arrears. | Nguyen $200, Patel $690, Okafor $350. Total $1,240. |
| **Arrears state** | Clear, Paid ahead, Partial (some paid), Overdue (nothing paid), Disputed. | Nguyen: Partial · 12 days (6 Sep − 25 Aug). Okafor: Disputed. |
| **Disputed lease** | The tenant disagrees with the balance. Reminders are **paused** but rent keeps accruing. Pausing a reminder is not the same as forgiving rent. | L. Okafor's lease is disputed; his $350 still counts in arrears. |
| **Lease status** | Active, Ending soon (ends within 60 days), Disputed, Ended. | Patel's lease ends 31 Oct 2026, 55 days away, so it is Ending soon. |
| **Terminate lease** | End a lease early. Only future, **unpaid** charges are removed; any charge that already has a receipt against it is kept. | Terminate Rahman's lease and check his paid history is untouched. |
| **Change rent** | Set a new rent from a date. Only future unpaid charges are repriced; paid history is never rewritten. | Raise Chen's rent from $330 to $345 from 1 Oct 2026. |
| **Approved credit** | A reduction granted by an approver (for example for repairs the tenant paid). Reduces arrears. | Not in the sample data; the allocation kind exists. |
| **Reversal** | A bounced or refunded receipt. Recorded as a **new negative allocation**; the original receipt is never edited. There is no form for this yet; the behaviour is covered by automated tests. | If Patel's $690 were reversed, arrears would return to $1,380 and the original receipt would still be listed. |
| **Bond** | The security deposit. Deliberately **not** handled yet, because the family's bond rules are not approved. Kept separate from rent. | Not shown anywhere. |
| **Proration** | Charging part of a period when a lease starts or ends mid-period. Not applied; surfaced as "policy not approved". | — |

### 4.5 Bank import and matching (screen: Bank import & matching)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Bank import** | One uploaded statement for one account and period, moving through stages. | CBA Everyday, 1 to 31 Aug 2026, imported 4 Sep 2026, 38 rows. |
| **Import stages** | Upload → Validate → Duplicates → Match & confirm → Post. "Posted" means finished. Shown as a stepper. | The sample import sits at **Match & confirm**. |
| **Statement CSV format** | The file layout accepted: a header row with `Date, Amount, Description, Reference` (Reference optional; any order; case does not matter). Positive amounts are money in, negative money out. Amounts like `$1,860.00`, `-125.50`, `(125.50)` are all accepted. One bad row rejects the whole file. | See §9 for a ready-to-paste sample. |
| **Staged transaction** | One statement line waiting to be matched and confirmed. Staged rows never change any historical figure. | `NGUYEN A RENT RM3`, +$300, 28 Aug 2026. |
| **Raw description / raw reference** | The bank's own text for the line. It is **never rewritten**, even after matching. | `URBAN UTILITIES 4471`, `Direct debit`. |
| **Suggestion** | The app's guess at what the line is: rent for a lease, a bill, an expense, an internal transfer. A suggestion is **not** a posting. | "Rent · A. Nguyen · Room 3 · charge 25 Aug ($500) · Partial payment · $200 remains". |
| **Confidence** | How sure the guess is, 0 to 1, shown as a bar. A receipt quoting a lease reference scores 0.9; a tenant surname or property name scores 0.6; anything else is unmatched. | Nguyen 0.94 (reference matched). Bunnings 0.41 (property unknown). |
| **Transaction state** | Auto-matched (confident guess, awaiting confirmation), Needs review (low confidence), Unmatched (no guess), Confirmed (a person agreed). | 31 auto-matched, 3 needs review, 4 unmatched in the sample import. |
| **Confirm** | A person agrees with the suggestion. Nothing reaches the books without this. | Confirm the Nguyen row. |
| **Confirm all high-confidence** | One click that confirms only rows at or above the high-confidence threshold. Low-confidence and unmatched rows are never swept up. | Confirms the 31 auto-matched rows; leaves 7 alone. |
| **Allocate** | A person tells the app what an unmatched or doubtful row is. A human choice outranks the machine's guess. | Allocate `DEPOSIT 1849` (+$1,200) to a lease. |
| **Leave unmatched** | Mark a row as "we do not know". It neither blocks posting nor gets posted. | Leave `EFTPOS 8842 OXLEY` unmatched. |
| **Duplicate** | A row that matches an already-staged row on date, amount and reference. Skipped, counted, never staged twice. A file that is *all* duplicates is rejected. | The sample import skipped 3 duplicates from 21 Aug onward. |
| **Internal transfer** | Money moved between the family's own accounts. **Excluded** from income and expenses. | `TRANSFER TO 06-2233`, −$5,000, "Internal transfer · Esteem Dev offset". |
| **Post to ledger** | The final step: confirmed rows are rolled into monthly cash-flow history and stamped, so they can never be posted twice or edited again. Refused while any row is still auto-matched or needs review. | Cannot post the sample import until the 34 unconfirmed rows are dealt with. |
| **Cash flow / receipts / outgoings** | Receipts = money in (rent). Outgoings = money out. Net = the difference. Shown per month on the dashboard chart. | Aug 2026: receipts $28,410, outgoings $19,870. |
| **Cash basis** | Cash flow counts only real money moving. Transfers and loan drawdowns are not income; loan principal repayments are cash out but not an interest expense. | The −$5,000 transfer does not appear in outgoings. |
| **Unallocated amount** | The total of rows nobody has matched yet. | $3,120 across the 4 unmatched rows. |

### 4.6 Shared bills and recoveries (screen: Shared bills & recoveries)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Shared bill** | One supplier bill for a cost that several tenants (and possibly the owner) share. Categories: water, electricity, gas, internet, cleaning, other. | Urban Utilities water bill 4471, $412, for 166 Compton Rd, Jul–Aug 2026. |
| **Bill period / due date / effective date** | Period = what dates the bill covers. Due = when it must be paid. Effective = the accounting date it belongs to (usually the end of the period). | 4471: period 1 Jul–31 Aug, due 28 Aug, effective 31 Aug. |
| **Allocation agreement** | The **signed rule** that says how bills at a property are split. Must be **approved** and **in force on the bill's effective date** before the app will split anything. | "60/40 to Rooms 1–3 and Rooms 4–6", approved 5 Sep 2026, effective from 1 Jul 2026. |
| **Superseded agreement** | An older agreement that was replaced. Kept so history can be inspected. | The earlier 50/50 water agreement (Feb 2025 to 30 Jun 2026). |
| **Share / weight** | One slice of a bill: who gets it and what percentage (or fixed amount). The dollar amount is **recalculated from the total every time**, never trusted from storage. | Rooms 1–3: 60% of $412 = $247.20. Rooms 4–6: 40% = $164.80. |
| **Recoverable share vs owner cost** | Recoverable = charged to a tenant; it is the tenant's cost, not the owner's. Owner cost = the part the owner pays. Counting both would double-count. | Water is recoverable from tenants. Common-area electricity (Energex) is 100% owner cost. |
| **Blocked bill** | A bill the app refuses to split, with the reason shown. Two different reasons: **no agreement at all**, or an agreement that is **not approved**. The whole amount falls to the owner until fixed. | Benton St water ($214.50): agreement exists but is unapproved. Mians Rd internet ($89): no agreement. |
| **Recovery review** | A person confirming that the bill really is recoverable. "Not yet reviewed" is deliberately different from "reviewed and not recoverable". | Bill 4471 was reviewed 26 Aug 2026. The Energex bill and the cleaning bill are not yet reviewed. |
| **Recovery deadline** | A date by which the recovery must be raised, entered by a person. The app never invents one. | Cleaning bill BSC-2208: 30 Nov 2026. |
| **Post to leases** | Turn each recoverable share into a **utility charge** on the tenant's lease, due on the bill's due date. Allowed once per bill. Refused for blocked or unreviewed bills. | Post bill 4471 and Okafor's and Williams's leases each gain a utility charge. |
| **Rounding rule** | When a total is split, the parts must add back to the total to the cent. Leftover cents go to the first parts. | $100 split three ways gives $33.34, $33.33, $33.33. |

### 4.7 Obligations and reminders (screen: Obligations & reminders)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Obligation** | Something that must be paid or done by a date: insurance, rates, a safety certificate, a rate review. | "Landlord insurance renewal · 166 Compton Rd · Terri Scheer", $1,860, due 14 Sep 2026. |
| **Owner** | The person responsible. **No owner means no reminders** — the app refuses to send and flags the gap instead. | "Smoke alarm compliance · Mians Rd" has no owner. |
| **Due date** | When it falls due. Status is calculated from it. | Body corporate levy, Watson Rd, due 1 Sep 2026. |
| **Recurrence** | Once, Monthly, Quarterly or Yearly. When a recurring obligation is paid, the next one is created automatically, stepping from the **due** date. | Council rates are Quarterly. Pay "Council rates · Q1" (due 18 Sep) and a new one due 18 Dec appears. |
| **Amount** | The expected cost. May be blank for things that are tasks, not payments. | "Loan rate review" has no amount. |
| **Evidence** | The document that proves it: Attached, Missing (expected but not there), or None. | "Body corporate levy" shows "No invoice". |
| **Paid on** | The date it was paid. Can only be set **together with a document** (payment evidence). A reminder being sent never sets it. | Pest control at Benton St: paid 13 Aug 2026, receipt attached. |
| **Disputed** | Under query. Reminders are suppressed. | Mark any obligation disputed and its reminders stop. |
| **Status** (calculated, never stored) | Paid · Disputed · Overdue (due date passed, unpaid) · Reminder queued · Scheduled (in the future) · Not eligible (no owner, or reminders off). | Water usage (due 28 Aug) is Overdue. Insurance Compton (14 Sep) has a reminder queued. Smoke alarm is Not eligible. |
| **Validated** | Someone checked the obligation is real and correctly entered. Shown with who and when. | Most sample obligations were validated in Aug 2026. |
| **Reminder policy** | The rules for reminding: channels (in-app, email), how many days before, quiet hours, when to escalate. | House default: email + in-app, 5 days before, quiet hours 9 pm to 8 am AEST, escalate 1 day after due. |
| **Quiet hours** | A window in which nothing is sent. A reminder falling inside it is deferred. | 21:00 to 08:00 AEST. |
| **Reminder event** | One attempt to remind: Queued, Sent, Delivered, Failed, Cancelled or Skipped, with a note. | 23 Aug: water usage reminder sent to Mahvish. 1 Sep: body corporate email bounced (Failed). |
| **Skip reason** | Why a reminder was not sent: paid, disputed, no owner, reminders off, quiet hours, already sent. | Run the dispatch and see skipped items with reasons. |
| **Dispatch key** | A unique tag of obligation + recipient + channel + date. Running the reminder job twice produces **no duplicate** sends. | Run "reminder dispatch" twice; the second run reports "already sent". |
| **Recheck before sending** | Immediately before a reminder goes, the app rechecks paid and disputed status. A paid item cancels instead of sending. | Pay an obligation with a queued reminder, then run dispatch: cancelled, not sent. |
| **Escalation** | If still unpaid after the due date, an escalation is due. Creating a follow-up task is **not** built yet. | Policy says escalate 1 day after due. |
| **Due in next 14 days** | The dashboard window for upcoming obligations. | 7 items, $9,320 (6 Sep to 20 Sep 2026). |

### 4.8 Expenses (screen: Expenses)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Expense** | A cost the owner bore: what, how much, when, for which entity and property, from where. | "Plumbing · leaking cistern Room 2", $486.20, Compton Rd, Family Trust, 4 Jul 2026. |
| **Category** | Insurance, Council rates, Utilities, Repairs & maintenance, Management fees, Body corporate, Compliance, Loan interest, Professional fees, Other. | Loan interest is the largest recurring category. |
| **Effective date vs posted date** | Effective = the date the cost belongs to. Posted = when it was entered. Reports use effective; the audit trail uses posted. | A bill dated 31 Aug entered on 5 Sep belongs to August. |
| **Amount basis** | Actual (a real figure), Forecast, or Estimated. Only Actual shows without a warning chip. The "Not actual" filter finds the others. | One seeded expense is Estimated so the filter has something to show. |
| **Revision / correction** | A change to an expense creates **version 2**; version 1 stays readable. A **reason is mandatory**. | "Water usage · Rooms 1–3": v1 $206 (50/50 split) → v2 $247.20 (60/40 split), corrected by Mahvish. |
| **Void** | Cancel an expense. It leaves the totals but the record and every version stay. There is no delete. | "Hardware purchase" was voided because the property could not be determined. |
| **Source** | Where it came from: entered by hand, a bank transaction, a shared bill share, or an obligation. This is what lets a report total drill down to evidence. | The Benton St insurance expense's source is the "Landlord insurance renewal" obligation. |
| **Allocation** | The entity (and optionally the property) the cost belongs to. | Entity: Esteem Development; property: 20 Benton St. |
| **Operating result** | Receipts less operating expenses. Reported separately from cash flow, which is a different measure. | Explain page `/explain/operating-expenses`. |

### 4.9 Documents (screen: Documents)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Document record** | A register entry describing a file: name, type, who uploaded it, when, and what it is linked to. **The file itself is not stored in this build**; only its details. | "Terri Scheer landlord policy 2026-27.pdf", uploaded by Jawad, 20 Aug 2026. |
| **Document type** | Lease, Insurance policy, Bill, Invoice, Receipt, Loan, Valuation, Other. | The Urban Utilities bill is type Bill. |
| **Version** | A newer copy of the same document. Versions are added, never replaced. | An amended lease becomes version 2; the signed original stays as version 1. |
| **Link** | What the document belongs to: a property, an entity, an obligation, a lease, a loan or a valuation. A document can have several links. | The Terri Scheer policy is linked to 166 Compton Rd **and** to the "Landlord insurance renewal" obligation. |
| **Unlinked** | A document with no links. It is surfaced so someone can file it; the app never guesses. | `Scan_20260903_0007.pdf` and `IMG_4471.jpg` (a photo of a receipt). |
| **Remove** | Hides the document and records who removed it and when. Nothing is destroyed. | Remove any document, then confirm the audit log shows it. |
| **AI extraction approval** | A per-document switch allowing an AI to read it. **Off** for every document and nothing is sent anywhere in this release. | Every document shows it off. |
| **Filters** | All, Leases, Insurance, Invoices & receipts, Loans, Valuations, Unlinked. | About 142 documents in the register. |

### 4.10 Dashboard, totals and reports (screens: Dashboard, Explain)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **As-of date** | The date every total is calculated for. Shown on the dashboard. | 6 Sep 2026. |
| **Net worth** | Assets − Liabilities, at the as-of date. | $4,370,000 − $2,206,700 = **$2,163,300**. |
| **Assets (included interests)** | Each property counted once at the owner's share, using its latest valuation, **plus receivables**. The SMSF is excluded. | $1,180,000 + $940,000 + $1,052,000 + $760,000 + $318,000 + $120,000 receivable = **$4,370,000**. |
| **Liabilities** | The unpaid balance of every loan the family owes. Receivables are never included. | $612,400 + $1,184,000 + $410,300 = **$2,206,700**. |
| **KPI tile** | One headline number with a label, a date and (sometimes) a change indicator. One tile per screen is highlighted as the hero. | "Net worth · $2,163,300 · as of 6 Sep 2026". |
| **Delta / movement** | The change versus the last saved **snapshot**, not a recalculation of history. Blank when the dashboard is scoped to one entity. | Net worth +2.1% vs Jun. Rent received +3.4% vs Jul. |
| **Snapshot** | A saved copy of the portfolio figures at a past date, used as the comparison point. | A June 2026 snapshot exists. |
| **Rent received / Cash outgoings (month)** | The cash-basis figures for the latest posted month. | Aug 2026: $28,410 in, $19,870 out. |
| **Rent arrears (tile and table)** | Total unpaid rent, with a table of who owes what. | $1,240 across 3 tenants, 1 disputed. |
| **Due in next 14 days** | Obligations falling due within the window. | 7 items, $9,320. |
| **Attention strip** | A row of warnings: overdue items, stale valuations, unmatched bank rows, missing owners, missing due dates. | Stale valuation on Benton St; 4 unmatched bank rows; smoke alarm with no owner. |
| **Explain this total** | The link under a figure that opens `/explain/<metric>`: a list of every record behind the number, each naming its source, with a banner confirming they add up to the total exactly. | `/explain/net-worth` lists the five properties, the receivable and the three loans. |
| **Reconciles** | The explain page adds its lines and compares them with the headline. Green banner = matches to the cent. Amber banner = does not match (that is a defect). | Every metric should show the green banner. |
| **Scope switcher** | A drop-down on the dashboard: "All Entities (Consolidated)" or one entity. Scoping narrows net worth, assets, liabilities, stale valuations and the ownership view to that entity's share. Cash flow, arrears and obligations stay whole-portfolio, and a banner says so. | Scope to Esteem Development: assets = Benton St + Logan Reserve; liabilities = CBA 8820. |
| **Ownership view** | A breakdown of assets by owning entity. | Family Trust, Esteem Development, Jawad, Mahvish. |
| **Export** | A CSV download, either of an explain page (`/api/exports/<metric>`) or of a list screen (`/api/export/properties`, `leases`, `loans`, `obligations`). It applies the **same permissions as the screen**: you need both the right to see the data and the right to export. | A. Kumar (accountant) can export operating expenses but is refused net worth. |
| **Search** | The top-bar box. Every word typed must appear in the record. At most 5 results per category, with "5 of 12" style counts. Results a persona may not see are removed **before** counting. | "compton water" finds the Compton Rd water bill. |
| **Notifications (bell)** | A live list: overdue rent, overdue obligations, due within 14 days, unmatched bank rows. Permission-filtered like search. | Jawad sees all of them; Hassan sees obligations only. |

### 4.11 Access, roles and the audit log (screen: Access & audit)

| Term | Plain meaning | Example in the sample data |
| --- | --- | --- |
| **Role** | A named bundle of permissions. Five exist. | See the table below. |
| **Capability** | One specific permission, e.g. "read leases", "write bank imports", "create exports". **Deny by default**: if a role does not list it, it is refused. | An operations delegate has `obligation.write` but not `loan.read`. |
| **Scope: all / restricted** | Whether the person can reach the whole portfolio or only named properties and entities. In this build the per-record filter is applied in **search**, the **notifications bell** and the **list exports** (`/api/export/...`). The record APIs such as `/api/properties/{id}` check the role but not yet the property list (see §8). | Mahvish is restricted to 166 Compton Rd and 20 Benton St: her `/api/export/leases` contains only those two properties' leases. |
| **Enforced server-side** | The check happens where the data is read, so calling the API, searching or exporting cannot get around it. Role (capability) checks run on every `/api/...` address, on search, on exports, and on the Dashboard, Explain and Access screens. The other list screens and their buttons are **not yet** gated by role (see §8). | As Mahvish, open `/api/dashboard/net-worth` or `/api/loans` directly: refused. Open `/dashboard`: an "access denied" explanation instead of the tiles. |
| **Persona switcher** | The test-only way to change who you are (§2.1). Audited. | Top-right avatar → "Test personas". |
| **Access grant** | The record of what a person can see, in plain words, with an optional expiry. | A. Kumar: "Approved FY26 records & exports · expires 31 Oct 2026". |
| **Invite** | Add a new person with a role and scope. Needs the `access.write` capability (Portfolio owner only). No email is sent. | Invite a second accountant and confirm the audit entry. |
| **Audit log / audit event** | An append-only list of who did what, when, to which record, with an outcome of ok or failed. Every action in the app writes one. | "Water usage bill split changed 50/50 → 60/40 · Mahvish · yesterday 17:20". |
| **MFA** | Multi-factor authentication. **Displayed only** ("on" / "not required"); real authentication is not built. | Jawad: on. Hassan: not required. |
| **External** | A person outside the household. Shown as a sub-label. | A. Kumar, CPA; KEYOB operator. |
| **Continuity posture / emergency access** | Who gets emergency access, when the instructions were last reviewed, and the backup status. Displayed, not enacted. | Emergency contact: Mahvish Gull, 72 hours after approval, not yet activated. Backups daily, last 6 Sep 02:00. |

**The five roles**

| Role | Sample person | May do | May not do |
| --- | --- | --- | --- |
| Portfolio owner | Jawad Siddique | Everything: all screens, whole-portfolio totals, bank import confirm/post, exports, inviting and granting access | — |
| Operations delegate | Mahvish Gull (Compton Rd + Benton St only) | View properties, leases, obligations, expenses, documents and bank imports for her properties; record obligation payments, assign owners, mark disputes | See net worth, assets or liabilities; see loans or entities; confirm or post bank rows; export; grant access |
| Family contributor | Hassan Siddique | See obligations (assigned tasks) | Anything else: no properties, totals, exports or access |
| Accountant · read-only | A. Kumar, CPA (expires 31 Oct 2026) | Read properties, leases, obligations, expenses, documents, loans, entities; create exports of those | See bank imports; edit anything; see portfolio totals or export net worth; grant access |
| Technical operator | KEYOB operator | Read the audit log | Any business data |

"May not do" is what the permission model says. In this build it is enforced on the
API, search, exports and on the Dashboard, Explain and Access screens. The other
list screens still render for every persona, and their buttons are not yet
role-restricted. That is a known gap (§8), not something to re-report.

---

## 5. The sample world

This is the data every fresh install starts with. Learn it and you will spot wrong
numbers quickly.

### 5.1 People (users of the app)

| Name | Role | Scope | Notes |
| --- | --- | --- | --- |
| Jawad Siddique | Portfolio owner | Everything | Default persona. MFA on. |
| Mahvish Gull | Operations delegate | 166 Compton Rd, 20 Benton St | No whole-portfolio totals. Also the emergency contact. |
| Hassan Siddique | Family contributor | Assigned tasks only | "Training & travel budget". No properties. |
| A. Kumar, CPA | Accountant · read-only | Approved FY26 records & exports | External. Grant expires 31 Oct 2026. |
| KEYOB operator | Technical operator | Deployment, monitoring, recovery | External. Audit log only. |

### 5.2 Entities and who owns what

| Entity | Kind | Owns | Other relationships |
| --- | --- | --- | --- |
| Siddique Family Trust | Discretionary trust, est. 2019 | 166 Compton Rd (100%), Mians Rd (100%) | Trustee: Esteem Development. Beneficiaries: Jawad, Mahvish, Hassan. Borrower on ANZ 3305. |
| Esteem Development Pty Ltd | Company | 20 Benton St (100%), Lot 12 Logan Reserve (100%) | Director: Jawad. Trustee of the Family Trust. Borrower on CBA 8820. |
| Jawad Siddique | Individual | Watson Rd (50%) | Director of Esteem; beneficiary of the Trust; member of the SMSF; lender to S. Khalid; co-borrower on Macquarie 4417. |
| Mahvish Gull | Individual | Watson Rd (50%) | Beneficiary of the Trust; member of the SMSF; co-borrower on Macquarie 4417. |
| Hassan Siddique | Individual | Nothing yet | Beneficiary of the Trust. |
| Siddique Superannuation Fund | SMSF | — | Manual summary, not included in totals (Release 2). |

### 5.3 Properties

| Property | Owner | Status / mode | Latest valuation | Valued | Basis | Stale? | Debt secured |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 166 Compton Rd, Woodridge QLD 4114 | Family Trust | Rented, by room (6 rooms; Room 6 vacant since 24 Aug) | $1,180,000 | 18 Aug 2026 | Bank | No | CBA 8820 (pooled with Benton St) |
| 20 Benton St, Acacia Ridge QLD 4110 | Esteem Development | Rented, whole | $940,000 | 10 Jun 2025 | Agent appraisal | **Yes** | CBA 8820 (pooled) |
| Watson Rd, Acacia Ridge QLD 4110 | Jawad 50% / Mahvish 50% | Own home, not rented | $1,052,000 | 4 Mar 2026 | Bank | No | Macquarie 4417 |
| Mians Rd, Woodridge QLD 4114 | Family Trust | Vacant since 20 Aug 2026, whole | $760,000 | 2 May 2023 | Purchase price | Yes, and never eligible for ratios | ANZ 3305 |
| Lot 12, Logan Reserve QLD 4133 | Esteem Development | Under construction | $318,000 | — | At cost | Not eligible | — |

Purchase prices and settlement costs: Compton $812,000 + $34,500 · Benton $795,000 +
$33,200 · Watson $640,000 + $24,800 · Mians $760,000 + $28,000.

### 5.4 Loans

| Facility | Direction | Borrower | Balance | As of | Rate | Repayment | Security |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Macquarie · Home loan 4417 | Liability | Jawad & Mahvish | $612,400 | 31 Aug 2026 | 5.89% fixed until 30 Sep 2026 | P&I $3,860/month ($3,006 interest, $854 principal) | Watson Rd (single) |
| CBA · Investment loan 8820 | Liability | Esteem Development | $1,184,000 | 31 Aug 2026 | 6.34% variable | IO $6,250/month | Compton Rd + Benton St (pool; 50/50 policy **not approved**) |
| ANZ · Investment loan 3305 | Liability | Family Trust | $410,300 | 15 Aug 2026 | 6.19% variable | P&I $1,830/month | Mians Rd (single) |
| Personal loan · to S. Khalid | **Receivable** (asset) | Jawad is the lender | $120,000 | 1 Sep 2026 | 4% fixed | $2,500/month in | Unsecured |

### 5.5 Current leases and arrears

| Tenant | Where | Reference | Rent | Lease | Position at 6 Sep 2026 |
| --- | --- | --- | --- | --- | --- |
| L. Okafor | Compton Rd, Room 1 | 166C-R1 | $350 weekly | 1 Feb 2026 – 31 Jan 2027 | **Disputed**; $350 owing (31 Aug charge unpaid) |
| M. Chen | Compton Rd, Room 2 | 166C-R2 | $330 weekly | 15 Apr 2026 – 14 Apr 2027 | Clear |
| A. Nguyen | Compton Rd, Room 3 | 166C-R3 | $500 fortnightly | 1 Jun 2026 – 31 May 2027 | **Partial**: $500 due 25 Aug, $300 received 28 Aug, $200 owing, 12 days |
| S. Williams | Compton Rd, Room 4 | 166C-R4 | $340 weekly | 1 Jul 2026 – 30 Jun 2027 | **Paid ahead** $340 ($680 received against a $340 charge) |
| D. Rahman | Compton Rd, Room 5 | 166C-R5 | $360 weekly | 10 Aug 2026 – 9 Aug 2027 | Clear |
| R. Patel | Benton St, whole | 20B-WH | $1,380 fortnightly | 1 Nov 2025 – 31 Oct 2026 | **Partial**: $1,380 due 28 Aug, $690 received 29 Aug, $690 owing. Lease **ending soon** |

Arrears total: **$1,240** (Nguyen $200 + Patel $690 + Okafor $350). Six ended leases
(T. Brooks, N. Ali, K. Tran, E. Mensah, P. Kaur, C. Doyle) are kept on record with
references ending in `-P`.

### 5.6 Obligations (23 in total)

| Group | Items |
| --- | --- |
| **Overdue** (2) | Water usage · shared bill, Compton Rd, $412, due 28 Aug (owner Mahvish, bill attached, reminder sent 23 Aug) · Body corporate levy, Watson Rd, $1,120, due 1 Sep (owner Jawad, no invoice, reminder email bounced 1 Sep) |
| **Due in the next 14 days** (7, $9,320) | Pest control Compton $420 (8 Sep) · Water usage Q3 Benton $268 (9 Sep) · Gutter clean Mians $380 (11 Sep, no invoice) · Property manager fee Benton $418 (13 Sep) · Landlord insurance Compton $1,860 (14 Sep, reminder queued) · Land tax Esteem $4,729 (16 Sep, not tied to a property) · Council rates Q1 Benton $1,245 (18 Sep) |
| **No owner** (1) | Smoke alarm compliance, Mians Rd, $180, due 22 Sep — **not eligible for reminders** |
| **Scheduled later** | Loan rate review 30 Sep (no amount) · Lease renewal decision Benton 1 Oct · Pool safety certificate Watson $145, 2 Oct · Council rates Q2 Compton $1,180, 15 Oct · Landlord insurance Mians $1,540, 20 Oct · Body corporate Q4 Watson $1,120, 1 Dec |
| **Paid** (6) | Insurance Benton (paid 1 Aug) · Water Q2 Compton · Body corporate Q2 · Insurance Mians · Council rates Q4 Compton · Smoke alarm Benton · Pest control Benton (paid 13 Aug) |

### 5.7 Bank import

One import: **CBA Everyday, 1–31 Aug 2026**, imported 4 Sep, stage **Match &
confirm**. 38 rows staged · 31 auto-matched · 3 needs review · 4 unmatched · $3,120
unallocated · 3 duplicates skipped (from 21 Aug).

Rows worth knowing:

| Date | Bank text | Amount | Suggestion | Confidence | State |
| --- | --- | --- | --- | --- | --- |
| 28 Aug | NGUYEN A RENT RM3 · Ref 166C-R3 | +$300.00 | Rent · A. Nguyen · Room 3 · partial, $200 remains | 0.94 | Auto-matched |
| 27 Aug | URBAN UTILITIES 4471 · Direct debit | −$412.00 | Water usage · Compton Rd · split 60/40 | 0.88 | Auto-matched |
| 26 Aug | TRANSFER TO 06-2233 · Own account | −$5,000.00 | Internal transfer · excluded from income and expenses | 0.97 | Auto-matched |
| 22 Aug | BUNNINGS 2211 OXLEY · Card | −$286.40 | Repairs & maintenance · property? | 0.41 | Needs review |
| 19 Aug | DEPOSIT 1849 · Cash deposit | +$1,200.00 | — | — | Unmatched |
| 14 Aug | EFTPOS 8842 OXLEY · Card | −$64.90 | Possible property expense · no matching supplier | 0.29 | Needs review |

Twelve months of posted cash-flow history sit behind the dashboard chart.

### 5.8 Shared bills (11) and agreements (4)

| Bill | Property | Total | Agreement | Result |
| --- | --- | --- | --- | --- |
| Urban Utilities water 4471, Jul–Aug 2026 | Compton Rd | $412.00 | 60/40 Rooms 1–3 / Rooms 4–6 (approved 5 Sep 2026) | Recoverable: $247.20 + $164.80. Reviewed 26 Aug. |
| Energex electricity 7741, Jul–Aug 2026 | Compton Rd | $186.40 | 100% owner · common areas | Owner cost. **Not yet reviewed.** |
| Bright Spaces cleaning BSC-2208, Aug 2026 | Compton Rd | $320.00 | 60/40 | $192 + $128. Not yet reviewed. Recovery deadline 30 Nov 2026. |
| Urban Utilities water, Jun–Jul 2026 | Benton St | $214.50 | 100% to tenant — **not approved** | **Blocked**: agreement unapproved. |
| Aussie Broadband internet AB-99120, Aug 2026 | Mians Rd | $89.00 | **None** | **Blocked**: no agreement. Owner cost (vacant). |
| Three earlier water bills (Jan–Jun 2026) | Compton Rd | $372.80, $401.50, $388.00 | Superseded 50/50 agreement | Split 50/50, reviewed. Shows the history before the change. |
| Three earlier electricity bills | Compton Rd | $198.60, $231.75, $204.10 | 100% owner | Owner cost. |

### 5.9 Expenses, documents and audit

- **49 expenses** across all categories, Jan–Sep 2026. One **corrected** (Water usage
  Rooms 1–3: $206 → $247.20 when the split changed), one **voided** (Hardware
  purchase, property unknown), one **Estimated**.
- **About 142 documents**: rates notices, insurance policies, bank and loan
  statements, signed leases, utility bills, maintenance invoices, compliance
  certificates, valuations, trust deeds. Two are unlinked.
- **About 28 audit events**, from a restore test on 1 Sep to a CSV import at 08:51 on
  6 Sep.

### 5.10 Expected headline figures (Jawad, as of 6 Sep 2026)

| Figure | Expected |
| --- | --- |
| Net worth | $2,163,300 (+2.1% vs Jun) |
| Assets (included interests) | $4,370,000 |
| Liabilities | $2,206,700 |
| Rent received · Aug 2026 | $28,410 (+3.4% vs Jul) |
| Cash outgoings · Aug 2026 | $19,870 (+3.5% vs Jul) |
| Rent arrears | $1,240 · 3 tenants · 1 disputed |
| Due in next 14 days | 7 items · $9,320 |
| Open obligations badge | Count of unpaid obligations |
| Unmatched transactions badge | 4 |
| Bank import summary | 38 · 31 · 3 · 4 · $3,120 · 3 duplicates |
| Watson Rd LVR | ≈ 58.2% |
| Mians Rd LVR, CBA pool LVR | Unavailable (with reason) |

If any of these differ on a fresh install with the as-of date at 6 Sep 2026, log it.

---

## 6. What you can do on each screen

Every button below calls a server action that validates the input, records an audit
entry and refreshes the screen. Field errors should appear next to the field.

| Screen | Actions available |
| --- | --- |
| Dashboard | Switch entity scope · open "Explain this total" for each figure · export a CSV from an explain page |
| Obligations & reminders | Filter (All, Due this week, Overdue, No owner, Paid) · Create obligation · Record payment (requires a document) · Mark disputed · Assign owner · Edit reminder policy · **Run reminder dispatch** (the manual stand-in for the scheduler) |
| Bank import & matching | **Upload / paste a CSV** (starts a new import) · Confirm one row · Confirm all high-confidence · Allocate a row to a lease, bill or expense · Leave unmatched · **Post to ledger** |
| Shared bills & recoveries | Filter (All bills, Recoverable, Owner cost, Needs review, Blocked) · Create shared bill · Record recovery review · **Post to leases** |
| Expenses | Filter by category, period, Not actual, Voided · Create expense · Correct (new version, reason required) · Void |
| Loans & liabilities | Add facility (rate entered as a percentage) |
| Properties & assets | Filter (Rented, Own home, Vacant, Under construction, Stale valuation, Ownership) · Create property · Edit property · Add valuation · Add room/component · open a property to see its tabs: Overview, Rooms & leases, Loans, Obligations, Documents, Valuations, History |
| Leases & tenants | Filter (Active, Ending in 60 days, Ended) · Create lease (charges are generated at once) · Record rent payment · Change rent · Terminate. (No form yet for credits or reversals.) |
| Entities & ownership | Create entity · Create relationship (owns with a share, or a control relationship without one) |
| Documents | Filter · Register document · Link to a record · Add version · Remove (hide) |
| Access & audit | Switch persona (top bar) · Invite a person (Portfolio owner only) · read the audit log |
| Top bar | Search · Notifications bell · Persona switcher |

---

## 7. Rules the system must never break

Each is a business rule from the requirements. For each, a way to check it.

1. **Every property is counted once, whatever the structure.** Open
   `/explain/assets`. Compton Rd must appear once at $1,180,000 even though a trust,
   a trustee company and three beneficiaries touch it. Add a second "owns" claim on
   the same property and the total must not double.
2. **Control never carries a share.** On Entities, try to create a "beneficiary of"
   relationship with a percentage. It must be refused with a field error.
3. **A receivable is an asset, not debt.** The S. Khalid loan must appear in Assets
   and never in Liabilities. Liabilities must be exactly $2,206,700.
4. **Net worth always shows its date.** Change nothing; just confirm the date is on
   the tile and on the explain page.
5. **Unavailable beats zero.** Mians Rd LVR and the CBA pool LVR must read
   "Unavailable" with a reason, never 0%. Add a fresh bank valuation to Mians Rd and
   the LVR must appear.
6. **Stale valuations are shown, not hidden.** Benton St must be flagged stale but
   still counted in assets at $940,000.
7. **Arrears are calculated, never stored.** Record a $200 payment for A. Nguyen and
   arrears must fall to $1,040 immediately, on the leases screen, the dashboard tile
   and `/explain/arrears` alike.
8. **Future rent is not arrears.** Create a lease starting next month; arrears must
   not change.
9. **Reversals restore the balance and keep the original.** There is no reversal
   form in this build, so this is verified by the automated test
   `uat-02-reconciliation` only. If a form is added later: reversing Patel's $690
   must raise arrears to $1,930 and the original receipt must still be listed.
10. **Splits add up to the cent.** Create a $100 bill split 3 ways: the shares must
    total exactly $100.00. Create a $200 bill split 60/40: $120 and $80.
11. **No approved agreement, no split.** The Benton St water bill must stay blocked
    until its agreement is approved. The app must never guess a split.
12. **A recovered cost is a tenant charge, not an owner expense.** Post bill 4471 to
    leases; the owner's operating expenses must not gain $412.
13. **Evidence closes an obligation; a reminder does not.** Run reminder dispatch for
    the overdue body corporate levy. It must stay Overdue. Then record payment with a
    document; only then does it become Paid.
14. **No owner, no reminders.** Run dispatch; the Mians Rd smoke alarm must be skipped
    with reason "no owner". Assign an owner and run again; it must now be eligible.
15. **Paid or disputed items suppress reminders.** Mark an obligation disputed, run
    dispatch, expect "skipped · disputed". Pay one with a queued reminder, run
    dispatch, expect "cancelled".
16. **Retries never double-send.** Run dispatch twice in a row. The second run must
    report "already sent" for everything the first run sent.
17. **Recurring obligations roll forward once.** Record payment on Council rates Q1
    (18 Sep). A new one due 18 Dec must appear. Record the same payment again; there
    must still be only one December instance.
18. **A suggestion is not a posting.** Upload a CSV. Nothing must change on the
    dashboard until rows are confirmed and the import is posted.
19. **Raw bank text is never rewritten.** After confirming or allocating a row, its
    original description must be unchanged.
20. **Duplicates are skipped, not staged twice.** Upload the same CSV twice. The
    second upload must report all rows as duplicates and create nothing.
21. **Bulk confirm never sweeps up doubt.** "Confirm all high-confidence" must leave
    the Bunnings, EFTPOS and unmatched rows exactly as they were.
22. **Posting is refused while rows are undecided.** With any row still auto-matched
    or needs-review, "Post to ledger" must be refused with a clear message.
23. **Transfers are not income or expenses.** After posting an import containing the
    −$5,000 transfer, August outgoings must not include it.
24. **Corrections append; nothing is overwritten or deleted.** Correct an expense
    without a reason: refused. With a reason: version 2 appears and version 1 is
    still readable. Void it: it leaves the totals but stays in the register.
25. **Documents are hidden, not deleted.** Remove a document, then check the audit
    log records it and the register no longer lists it.
26. **Every total can be explained, and reconciles.** Open all six `/explain/...`
    pages as Jawad. Each must show the green "reconcile exactly" banner.
27. **Deny by default on every data path.** As Mahvish: `/dashboard` must show an
    access-denied explanation, not tiles; `/explain/net-worth`,
    `/api/dashboard/net-worth`, `/api/loans` and `/api/entities` must be refused;
    search must not return loans; the bell must not list anything outside her two
    properties. As A. Kumar: `/api/bank-import` refused; `/api/exports/operating-expenses`
    allowed; `/api/exports/net-worth` refused. As the KEYOB operator: `/access` shows
    the audit log and nothing else. (The remaining list screens are not yet gated,
    see §8.)
28. **Restricted scope filters records, not just screens.** As Mahvish:
    `/api/search?q=watson` must return no Watson Rd property; the bell must not list
    the Watson Rd body corporate levy; `/api/export/leases` and
    `/api/export/obligations` must contain only Compton Rd and Benton St rows, and
    `/api/export/loans` must omit the Macquarie loan (secured by Watson Rd). Note:
    `/api/properties/prop-watson-rd` is **not** yet refused for her, because the
    record APIs check the role only. That is a known gap (§8), not a new finding.
29. **Exports match the screen.** The CSV from `/api/exports/arrears` must contain the
    same lines and total as `/explain/arrears`.
30. **Status is never colour alone.** Check every chip on every screen has an icon and
    text. Zoom the browser to 200% and switch to a narrow window; nothing should rely
    on colour.
31. **Forms fail gracefully.** Submit every form empty and with nonsense ("abc" for an
    amount, 31 Feb for a date). Expect a field-level message, never a blank page or a
    digest code.
32. **Money input is forgiving.** Amount fields must accept `1860`, `1,860.00` and
    `$1,860.00` and treat an empty field as "not given", not as zero.

---

## 8. Things that are not built yet (do not log these as bugs)

| Area | Not built | What you will see instead |
| --- | --- | --- |
| Sign-in | Real login, sessions, MFA | The persona switcher. MFA is a label only. |
| Permissions in the UI | Role checks on the Properties, Leases, Loans, Entities, Obligations, Bank import, Shared bills, Expenses and Documents **screens** and their buttons | Those screens render for every persona. Role enforcement exists on every `/api/...` address, on search, on exports, and on the Dashboard, Explain and Access screens. |
| Permissions by record | Filtering a restricted persona's view to *their* properties on the record APIs (`/api/properties/{id}`, `/api/leases`, `/api/obligations`, …) | Those APIs check the role only. The per-property filter is applied in search, the notifications bell and the list exports. |
| Leases | Forms for approved credits and reversals | Only "Record rent payment" exists. Credits and reversals are covered by automated tests. |
| Reminders | A scheduler that runs on its own; email or SMS delivery; template approval; escalation-to-task | A manual "Run reminder dispatch" button. Outcomes are recorded but nothing is sent. Quiet hours defer but do not re-queue. |
| Documents | File upload, storage, preview, download | Register entries only (name, type, size, links, versions). |
| Bank import | Real bank formats (separate debit/credit columns, OFX); amount-to-charge matching; supplier learning; a review list of skipped duplicates; a line-level ledger | A generic CSV layout; matching by lease reference or name only; posting rolls into monthly cash flow and does **not** create rent receipts or expenses by itself. |
| Dashboard | Scope by property or by period; snapshot creation on period close; entity-scoped drill-down | Scope by entity only. "Explain this total" is withheld on scoped tiles. |
| Leases | Bonds, proration of part periods, rent-increase *amendments* beyond "change rent" | Flagged as "policy not approved". |
| Shared bills | Creating or approving agreements in the UI; reversing a posting | Agreements are seeded. |
| Loans | Amortisation schedules, rate-change history, offset accounts, editing or closing a facility, creating a pooled facility from the form | Add-only. |
| Entities | Editing or ending an entity or relationship; refusing owners that exceed 100%; multi-level company ownership; contact details | Add-only. |
| Obligations | Full recurrence expansion (only the next instance is created, on payment) | One instance ahead. |
| Search | Fuzzy matching; highlighting; entities, expenses and projects | Exact-word matching. A tenant, obligation, loan or document result opens its list screen with that record selected and highlighted. Hidden on phones. |
| Multi-currency, tax, depreciation, CGT | Not modelled | AUD only; no tax figures. |
| Operations | Backups, retention policy, monitoring, load testing, formal WCAG audit | Continuity posture is displayed only. |

Later releases (FR-10 assisted statement reading, FR-11 budgeting and scenarios, FR-12
extended family modules) are out of scope by design.

---

## 9. A suggested first walkthrough

Do this once as Jawad before writing any test cases. About 90 minutes.

1. **Dashboard.** Compare every tile with §5.10. Click "Explain this total" on net
   worth, assets, liabilities and arrears. Read the lines; confirm the green banner.
2. **Entities.** Find the six entities. Read the relationships on the Family Trust
   and notice which carry a percentage and which do not.
3. **Properties.** Open 166 Compton Rd. Look at the rooms table, the valuation and
   the working debt figure. Open 20 Benton St and find the stale flag. Open Mians Rd
   and find "Unavailable".
4. **Loans.** Match the four rows to §5.4. Find the receivable and note it is not in
   the liabilities total.
5. **Leases.** Match the six current leases to §5.5. Filter Ended and find the six
   former tenants. Record a $200 payment for A. Nguyen and watch arrears drop to
   $1,040. Go back to the dashboard and confirm it agrees.
6. **Bank import.** Read the stepper. Find the six rows in §5.7. Click "Confirm all
   high-confidence" and check 31 rows confirmed, 7 untouched. Try "Post to ledger"
   and read the refusal. Then paste this CSV as a new import:

   ```
   Date,Amount,Description,Reference
   2026-09-01,500.00,NGUYEN A RENT RM3,166C-R3
   2026-09-01,-125.50,BUNNINGS 2211 OXLEY,Card
   2026-09-02,1380.00,PATEL R RENT,20B-WH
   ```

   Expect: the two rent rows auto-matched at 0.9 confidence (their references match
   live leases) and the Bunnings row **unmatched** (money out, no reference the
   matcher knows). Paste the same text again and expect the whole file to be
   rejected: "Every row in this statement has already been imported".
7. **Shared bills.** Filter Blocked and read the two different reasons. Open bill
   4471 and confirm $247.20 + $164.80. Record a recovery review on the Energex bill.
8. **Obligations.** Filter Overdue (2), No owner (1). Click "Run reminder dispatch"
   and read every outcome and skip reason. Run it again and confirm nothing is sent
   twice. Assign an owner to the smoke alarm and run again.
9. **Expenses.** Find the corrected water expense and open both versions. Find the
   voided hardware purchase. Filter "Not actual".
10. **Documents.** Filter Unlinked (2). Link one to a property. Add a version to
    another.
11. **Access & audit.** Read the grants. Scroll the audit log and find the entries
    your actions above created.
12. **Switch persona to Mahvish.** Open the dashboard and expect the access-denied
    explanation. Try the API addresses in rules 27 and 28 in a browser tab. Switch to
    A. Kumar and try `/api/exports/operating-expenses`, then `/api/exports/net-worth`.
    Switch to the KEYOB operator and confirm the Access screen shows only the audit
    log.
13. **Phone width.** Resize to about 400 px wide. Confirm the bottom tab bar, the
    collapsed tables and that the search box is hidden (by design).
14. **Reset** your environment (restart, or `npm run db:reset`) and confirm §5.10
    figures return.

---

## 10. Quick reference

### 10.1 Addresses

| Screen | Address |
| --- | --- |
| Dashboard | `/dashboard`, `/dashboard?entityId=ent-esteem` |
| Explain a total | `/explain/net-worth` · `/explain/assets` · `/explain/liabilities` · `/explain/arrears` · `/explain/upcoming-obligations` · `/explain/operating-expenses` |
| Property detail | `/properties/prop-compton-rd` · `prop-benton-st` · `prop-watson-rd` · `prop-mians-rd` · `prop-logan-reserve` |
| Others | `/obligations` `/bank-import` `/shared-bills` `/expenses` `/loans` `/properties` `/leases` `/entities` `/documents` `/access` `/design-system` |

Useful record IDs: entities `ent-jawad`, `ent-mahvish`, `ent-hassan`, `ent-esteem`,
`ent-family-trust`, `ent-smsf` · users `usr-jawad`, `usr-mahvish`, `usr-hassan`,
`usr-kumar`, `usr-keyob` · loans `loan-macq-4417`, `loan-cba-8820`, `loan-anz-3305`,
`loan-khalid-receivable` · leases `lease-166c-r1` … `lease-166c-r5`, `lease-20b-wh`.

### 10.2 Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `AS_OF_DATE` | `2026-09-06` | The frozen "today". Set to `today` to use the real clock (expected figures then change). |
| `DATABASE_URL` | unset | Unset = in-memory sample data that resets on restart. Set = Postgres, data persists, `npm run db:reset` re-seeds. |
| `DATA_ADAPTER` | unset | Force `memory` or `postgres`. |
| `NEXT_PUBLIC_LOCALE` | `en-AU` | Number and date formatting. |
| `NEXT_PUBLIC_APP_NAME` | `Holdfast` | Title in the shell. |

### 10.3 JSON API (same data as the screens, same permissions)

Every response is wrapped as `{ "data": ... }`; errors carry a message and a status
code. All accept the current persona.

```
GET /api/dashboard                 GET /api/dashboard/net-worth     GET /api/dashboard/ownership
GET /api/properties                GET /api/properties/{id}
GET /api/leases                    GET /api/leases/arrears
GET /api/loans                     GET /api/entities
GET /api/obligations               GET /api/obligations/{id}
GET /api/bank-import               GET /api/bank-import/transactions
GET /api/shared-bills              GET /api/expenses                GET /api/documents
GET /api/access
GET /api/search?q=compton
GET /api/explain/{metric}          GET /api/exports/{metric}        (CSV of an explain page)
GET /api/export/{resource}         resource = properties | leases | loans | obligations  (CSV of a list screen)
```

### 10.4 Commands

```
npm run dev          start locally on http://localhost:3000
npm test             run the automated tests
npm run db:reset     empty the Postgres tables so the sample data re-seeds (Postgres mode only)
npm run build        production build (stop the dev server first)
```

### 10.5 Automated tests you can point to

The test suite already encodes the acceptance scenarios from the requirements
document. If a manual test contradicts one of these, the automated test is the
reference and the manual finding is probably a real bug.

| Test file | What it proves |
| --- | --- |
| `uat-01-consolidation` | Joint ownership, corporate trustee, two-property loan: no double counting |
| `uat-02-reconciliation` | Partial, advance and combined payments, refunds, duplicate imports |
| `uat-03-reminders` | Paid/disputed suppress reminders; retries do not duplicate |
| `uat-04-permissions` | A delegate cannot reach restricted totals via URL, export or search |
| `uat-05-dashboard-fixtures` | The headline figures in §5.10, to the cent |
| `uat-07-data-quality` | Stale valuations, missing due dates and unmatched rows are flagged |
| `fr-05-lease-lifecycle` | Charge generation, termination keeps paid history, rent change |
| `fr-06-csv-import`, `fr-06-post-to-ledger` | CSV parsing, duplicates, matching, posting rules |
| `fr-07-shared-bills` | 60/40 of $200 = $120 + $80; invalid splits refused |
| `fr-04-expenses`, `fr-04-documents` | Versioning, void, hide-not-delete |
| `fr-09-drilldown`, `fr-09-exports`, `fr-09-scope`, `fr-09-search` | Explain pages reconcile; exports and search respect permissions; entity scope |
| `br-03-cash-basis`, `br-06-allocation` | Transfers excluded; splits sum exactly |
| `actions.test` | Every form action validates and returns field errors |

---

*End of guide.*
