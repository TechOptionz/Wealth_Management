# Design fidelity report

Verification of the running application against
`design/wealth-platform-design.html`.

The prototype is the source of truth for **design**: layout, colour, typography,
spacing, components and interaction. Its **numbers** are illustrative placeholders
— several of them do not reconcile with the records shown on the same screen, and
one contradicts a rule the design itself states. Where that happens the app
computes the figure from its records and the divergence is documented below with
the arithmetic.

## 1. Design preserved exactly

### Stylesheet — byte-identical
The prototype's `<style>` block was split into
`tokens / base / shell / components / responsive` and verified programmatically:

```
original rule lines: 348
ported   rule lines: 348
IDENTICAL (ignoring blank lines between sections): True
```

Nothing was rewritten, renamed, or converted to a utility framework. Every class
name, token, breakpoint and media query is the original.

- Palette: all 33 CSS custom properties, light and dark, identical to the design
  file. Their values were re-pointed to the analytica.live palette on 2026-09-27
  in both places at once — see §3.12.
- Dark mode: both `prefers-color-scheme` and `[data-theme]` blocks preserved.
- Breakpoints: 1320px, 1180px, 840px, plus `prefers-reduced-motion` — unchanged.
- Radii, shadows, sidebar/topbar/tabbar dimensions — unchanged.

### Icons
All 25 SVG symbols were extracted programmatically from the prototype's sprite
and emitted as `IconSprite.tsx`. Path data is unmodified; `<Icon />` renders the
same `<svg class="i"><use href="#i-*"/></svg>` markup.

### Typography
IBM Plex Sans at 400/500/600 plus 400 italic, now self-hosted via `next/font`
(faster and privacy-preserving) rather than fetched from Google's CDN.
`fonts.css` binds it to the design's `--font` token, keeping the original
fallback stack. Tabular numerals (`.num`) retained on every figure.

### Layout and responsive behaviour
- Desktop: 248px sidebar + fluid content capped at 1440px.
- ≤840px: sidebar becomes a drawer over a scrim, bottom tab bar appears, tables
  collapse to label/value cards via `table.stack-m` and `data-l` attributes.
- The `data-l` mechanism is preserved: `DataTable` emits each column's header as
  `data-l` on its cells, and marks the primary column `lead`.

### Accessibility (NFR-07)
- Every status chip pairs colour with an icon **and** words.
- `aria-pressed` on filters, `aria-current` on nav and tabs, `aria-selected` on
  tab strips and selectable rows.
- Clickable table rows gained keyboard handlers and `tabIndex` — an improvement
  on the prototype, which was mouse-only.
- Chart and ownership diagram keep `role="img"` with descriptive labels.

### Interaction parity
| Prototype behaviour | Implementation |
| --- | --- |
| View switching via `data-view` + `localStorage` | Real routes; browser history and deep links now work |
| Drawer open/close with scrim | `NavigationContext` |
| Filter pills toggle `aria-pressed` | `FilterGroup` with real state |
| Tab strips toggle `aria-selected` | `Tabs` |
| Toast for unwired actions | `ToastContext`, same markup and 2200ms timing |

## 2. Figures that now compute from records

These match the prototype exactly, because the seeded records reproduce them:

| Figure | Prototype | App | |
| --- | --- | --- | --- |
| Rent arrears total | $1,240 | $1,240 | ✅ |
| Arrears breakdown | 200 / 690 / 350 | 200 / 690 / 350 | ✅ |
| Arrears context | 3 tenants · 1 disputed | 3 tenants · 1 disputed | ✅ |
| Rent received · Aug | $28,410 | $28,410 | ✅ |
| Cash outgoings · Aug | $19,870 | $19,870 | ✅ |
| Net worth movement | +2.1% vs Jun | +2.1% vs Jun | ✅ |
| Principal repaid since Jun | $14,200 | $14,200 | ✅ |
| Rent received change | +3.4% vs Jul | +3.4% vs Jul | ✅ |
| Import: rows staged | 38 | 38 | ✅ |
| Import: auto-matched | 31 | 31 | ✅ |
| Import: needs review | 3 | 3 | ✅ |
| Import: unmatched | 4 · $3,120 | 4 · $3,120 | ✅ |
| Monthly repayments | $11,940 | $11,940 | ✅ |
| Next rate review | 30 Sep · Watson Rd · fixed 5.89% | identical | ✅ |
| Stale valuations | 3 | 3 | ✅ |
| Overdue obligations | 2 | 2 | ✅ |
| Obligations with no owner | 1 | 1 | ✅ |
| Ownership gap | Watson Rd: consolidation method not chosen | identical | ✅ |
| All property valuations & labels | 5 cards | identical | ✅ |
| Benton St rent/month | $2,990 | $2,990 | ✅ |
| Compton room table | 6 rows, balances −350/0/−200/+340/0 | identical | ✅ |
| Lease next-charge dates | 8 Sep, 9 Sep, Paused, 8 Sep | identical | ✅ |
| Patel lease status | Ends in 55 days | Ends in 55 days | ✅ |
| New lease charge count | 53 | 53 | ✅ |

## 3. Divergences, with reasons

### 3.1 Total debt — $2,206,700, not $2,326,700

The prototype's "Total debt" tile reads $2,326,700 and says "4 facilities".
The four facilities listed are:

```
Macquarie 4417   612,400  liability
CBA 8820       1,184,000  liability
ANZ 3305         410,300  liability
S. Khalid        120,000  RECEIVABLE  ("Receivable, not an expense (FR-11)")
                ─────────
liabilities    2,206,700
+ receivable     120,000
                ─────────
                2,326,700  ← the prototype's figure
```

The prototype adds the receivable into debt, which contradicts the FR-11 note
printed on that very row. The app counts it as an asset. **Total debt is
$2,206,700 across 3 liabilities.** This also changes the dashboard "Liabilities"
tile by the same $120,000.

*Recommend confirming against the requirements document; the app's treatment
follows FR-11 as the design states it.*

### 3.2 Assets and net worth — computed, and lower than the prototype

| | Prototype | App |
| --- | --- | --- |
| Assets | $7,148,000 | $4,370,000 |
| Liabilities | $2,326,700 | $2,206,700 |
| Net worth | $4,821,300 | $2,163,300 |

The prototype's three figures are internally consistent
(7,148,000 − 2,326,700 = 4,821,300) but its asset total cannot be reconstructed
from anything the design shows:

```
5 property valuations   4,250,000
+ loan receivable         120,000
                        ─────────
                        4,370,000   ← everything visible in the prototype
prototype assets        7,148,000
                        ─────────
unaccounted             2,778,000
```

There is no screen in the prototype showing the remaining $2.78M (cash, offset
balances, superannuation, or other holdings). Rather than invent records, the app
computes assets from what exists. Its ownership breakdown reconciles exactly:

```
Siddique Family Trust   1,529,700
Jawad Siddique            339,800
Mahvish Gull              219,800
Esteem Development         74,000
                        ─────────
                        2,163,300  = net worth ✅ (BR-02 verified)
```

The prototype's own entity figures do **not** reconcile this way — its dashboard
ownership view omits Mahvish entirely, and its Esteem figure ($1,810,000) cannot
be derived from Esteem's properties minus its debt ($1,258,000 − $1,184,000 =
$74,000).

**Open question for the requirements document: what asset classes beyond property
and receivables are in scope for Release 1?**

### 3.3 Portfolio LVR — "Unavailable", not 32.6%

The prototype shows 32.6%, labelled "Debt ÷ eligible collateral". That value is
reproducible only as `2,326,700 ÷ 7,148,000` — total debt over *total assets*,
not over collateral.

The app applies BR-04 strictly: two of the four properties securing debt
(20 Benton St, agent appraisal Jun 2025; Mians Rd, purchase price 2023) have no
valuation eligible for ratio maths, so the denominator is incomplete and the
ratio would understate gearing. It reports:

> **Unavailable** — Debt ÷ eligible collateral · 2 securing properties without an
> eligible valuation

This is the design's own "Unavailable beats zero" rule applied consistently. The
per-property LVR for Watson Rd (58.2%) still computes and matches the prototype.

### 3.4 Repayment split — $854 principal / $11,086 interest

The prototype states $9,140 principal and $2,800 interest of the $11,940 total.
That cannot hold: the CBA facility is interest-only at $6,250/month, so interest
alone is at least $6,250 — more than double the stated total interest.

The app stores the principal/interest split per facility as a recorded statement
fact and seeds each consistently with its own type and rate (IO = all interest).
The monthly total, $11,940, matches the prototype exactly.

*The $9,140 figure also appears in the Aug cash-outgoings footnote, where it is
retained as seeded posted-history data.*

### 3.5 Counts — now derived from a full dataset

Originally only the rows visible in the prototype were seeded, so every filter
count fell short of the prototype's label. The dataset has since been filled out
to a realistic working portfolio, and the counts now derive from real records:

| Filter | Prototype | App | |
| --- | --- | --- | --- |
| Obligations "All" | 23 | 23 | ✅ |
| Obligations "Due this week" | 4 | 4 | ✅ |
| Obligations "Overdue" | 2 | 2 | ✅ |
| Obligations "No owner" | 1 | 1 | ✅ |
| Documents "All" | 142 | 142 | ✅ |
| Documents "Unlinked" | 2 | 2 | ✅ |
| Entities "All" | 6 | 6 | ✅ |
| Properties "All" | 5 | 5 | ✅ |
| Leases "Active" | 7 | 6 | ⚠️ see below |

Counts are still *derived*, never hard-coded — they cannot contradict the list
beneath them.

**Leases "Active" remains 6, not 7.** A seventh active tenancy has nowhere
coherent to live: the prototype shows Room 6 at Compton Rd vacant since 24 Aug
(and targets it with the new-lease form) and Mians Rd vacant since its lease
ended 20 Aug. Adding a seventh would contradict the property data on the same
screen. Six ended tenancies are seeded instead, which explain both vacancy dates.

### 3.6 "Due in next 14 days" — now 7 items, $9,320 ✅

Previously 2 items totalling $3,105, because only the obligations visible in the
prototype were seeded. With the full obligation set the tile matches the
prototype exactly: **7 items · $9,320**, from a 14-day window with no change to
`UPCOMING_WINDOW_DAYS`.

One detail still differs: the prototype's footer chip reads "1 without owner",
whereas the app reads "All items owned". The unowned obligation (smoke alarm
compliance) falls due 22 Sep, which the prototype's own table shows — two days
outside the 14-day window. Keeping the prototype's date and an honest window
means the chip reports the all-clear. The unowned item is still plainly flagged
on the obligations screen itself.

### 3.7 Smaller derived differences

| Item | Prototype | App | Why |
| --- | --- | --- | --- |
| Compton Rd rent/month | $11,200 | $7,063 | Computed from the six room leases shown: (350+330+340+360)/wk + 500/fortnight, annualised ÷ 12 |
| A. Nguyen arrears age | "Partial · 4 days" | "Partial · 12 days" | The reconcile screen dates that charge 25 Aug; 6 Sep − 25 Aug = 12 |
| Cash outgoings delta | "–" (flat) | 3.5% | Aug $19,870 vs Jul $19,200 is a real +3.5%; the app shows it rather than suppressing it |
| Bank import table | 5 rows | 38 rows | The prototype showed a sample; the app lists the whole staged import |

## 3.8 New screens added after the requirements document

Three screens exist in the app that the prototype does not contain, because the
requirements document specifies them as first-release scope:

| Screen | Requirement | Design approach |
| --- | --- | --- |
| `/shared-bills` | **FR-07** — an MVP requirement the prototype only hints at, via its "Water usage · shared bill" row and the audit entry "split changed 50/50 → 60/40" | Built entirely from existing design-system components: `KpiGrid`, `FilterGroup`, `DataTable`, the two-column `Grid` with a detail panel — the same layout as the obligations screen |
| `/expenses` | **FR-04** — expense records, the half of FR-04 the prototype does not show | Same pattern; the category breakdown reuses the ownership view's bar treatment |
| `/explain/[metric]` | **FR-09** — "drill-down must explain every total"; the prototype's "Explain this total" link was a placeholder | Hero KPI + reconciliation `Banner` + `DataTable`, all existing components |

No new CSS was written for any of them. Every element uses a class name already
present in the prototype's stylesheet, which is why the class-usage audit still
reports zero invented classes.

## 3.9 Dataset filled out for demonstration

The seed originally held only the rows the prototype displays, which left several
screens looking empty and every filter tab under-populated. It now holds a
realistic working portfolio:

| Section | Before | Now |
| --- | --- | --- |
| Obligations | 7 | 23, across overdue / due-this-week / scheduled / paid |
| Documents | 5 | 142 — rates notices, policies, statements, leases, invoices, certificates, entity records |
| Expenses | 5 | 49 across ten categories and six months, one corrected and one voided |
| Shared bills | 3 | 11, including three under the superseded 50/50 agreement |
| Leases | 6 active | 6 active + 6 ended |
| Entities | 5 | 6 |
| Audit log | 6 | 28 |
| Valuations | 5 | 12, giving each property a history |
| Posted cash flow | 6 months | 12 months |

**Properties, loans and arrears-bearing leases were deliberately left untouched**,
because they drive the figures that already matched the prototype exactly: net
worth $2,163,300, arrears $1,240 (3 tenants · 1 disputed), the 38/31/3/4 · $3,120
import summary, and $11,940 of monthly repayments. All are unchanged, and the
UAT-05 fixture test proves it.

## 3.10 Chart anchoring corrected

The cash-flow chart originally anchored on the month containing the as-of date,
which appended an empty September bar — reading as a collapse in receipts rather
than as an unreconciled period. It now anchors on the latest *posted* month, so
it ends at August. This matches the prototype, which also shows Mar–Aug against a
6 September as-of date. Caught by `tests/uat-05-dashboard-fixtures.test.ts`.

## 3.11 One additive stylesheet: the modal dialog and print

The tenant statement on `/leases` (FR-05) opens in a modal and must print. The
prototype contains no dialog and no `@media print` rules, so there was nothing
to port. Rather than edit the five verbatim files, the rules live in a sixth
file, `src/styles/modal.css`, imported last from `globals.css`. The parity
check in §5 reads only the original five, so it still reports 348/348.

What it adds, and why each rule exists:

| Rule | Reason |
| --- | --- |
| `.modal`, `.modal.wide`, `.modal::backdrop`, `.modal-foot` | A native `<dialog>` in the top layer. The panel itself is a `.card`; the backdrop reuses the `.scrim` colour |
| `body:has(.modal[open]) { overflow: hidden }` | The page behind a modal should not scroll |
| `.statement-meta` | Four `.stat` blocks in an auto-fit grid — no spacing values outside §5 of the guide |
| `@media print` — `body:has(> .modal[open]) > :not(.modal[open]) { display: none }` | Print the open dialog and nothing else. The dialog is portalled to `<body>` so this one selector suffices |
| Print flattening of `.kpi.accent` and `.chip` to black on white | Paper does not follow the screen theme, and the hero tile would otherwise print as a solid dark block |
| Print undo of `table.stack-m` | A4 at 96 dpi is ~794px wide, narrower than the 840px breakpoint, so without this the ledger would print as mobile cards |

The only literal colours in the file are paper white, ink black and two greys
for print. Everything on screen uses the prototype's tokens.

## 3.12 Palette re-pointed to analytica.live

On 2026-09-27 the owner asked for the colour scheme of
[analytica.live](https://analytica.live/). Its stylesheet was read directly rather
than eyeballed: page `#08090a` (also its `theme-color`), card surface `#191b1d`,
borders `rgba(255,255,255,.08)`, text `#f7f8f8` with `#9ca3af` for muted copy,
and orange `#f77d00` on highlighted figures. Analytica ships dark only.

Per the rule in `AGENTS.md`, the change was made in **both** the design file and
`tokens.css` (and the §9 copy in `DESIGN_SYSTEM_GUIDE.md`) at the same time, and
the parity check in §5 still reports 348/348. Token *names* are unchanged —
`--gold` now holds orange — so no component CSS moved and the `.gold` class
names still refer to the same variants.

| Token | Was (light / dark) | Now (light / dark) |
| --- | --- | --- |
| `--ink`, `--side-bg`, `--solid`, `--hero` (light) | `#1c2128` | `#08090a` |
| `--ink-2` / `--ink-3` / `--ink-line` | `#252c35` / `#313a45` / `#3d4652` | `#151616` / `#1e1f21` / `#2c2c2c` |
| `--gold` | `#c9a55c` / `#d9b86c` | `#f77d00` / `#f77d00` |
| `--gold-deep` | `#a5843a` / `#e2c47e` | `#b05000` / `#ff965f` |
| `--gold-soft` · `--on-gold-soft` | `#f7efd9` · `#8a6a24` / `#332b18` · `#e6cb86` | `#fff1e6` · `#9a4700` / `#2b1806` · `#ffb27a` |
| `--bg` | `#f3f4f6` / `#15191f` | `#f7f8f8` / `#08090a` |
| `--surface` · `--surface-2` | `#ffffff` · `#f8f9fb` / `#1c2128` · `#20262e` | `#ffffff` · `#f2f3f4` / `#191b1d` · `#212326` |
| `--line` · `--line-2` | `#e3e6eb` · `#eef0f3` / `#2c343e` · `#252c35` | `#e5e7eb` · `#eef0f2` / `rgba(255,255,255,.08)` · `rgba(255,255,255,.05)` |
| `--text` · `--text-2` | `#1c2128` · `#4b5563` / `#e9ecf0` · `#c2c8d0` | `#08090a` · `#4a4a4a` / `#f7f8f8` · `#c9cdd3` |
| `--muted` · `--faint` | `#6b7280` · `#9aa1ac` / `#98a1ad` · `#6f7883` | `#6b7280` · `#9ca3af` / `#9ca3af` · `#6b7280` |
| `--good` | `#1f7a4d` / `#63d195` | `#2a7541` / `#4caf50` |
| `--warn` | `#9a5b00` / `#f0b65a` | `#9a5b00` / `#ffbb25` |
| `--bad` | `#b42318` / `#f5948b` | `#b33025` / `#f2625d` |
| `--info` | `#2c5e9e` / `#8ab8f5` | `#2a63c4` / `#6ea8ff` |
| status `-bg` (light) | `#e7f5ec` `#fff4dd` `#fdecea` `#e8f0fa` | `#e6f4ea` `#fff4dd` `#fdecea` `#e8f0fb` |
| status `-bg` (dark) | `#153726` `#3a2a08` `#3d1a16` `#182c45` | `#0f2a19` `#2c2208` `#33130f` `#0f1f3a` |
| `--hero` · `--hero-line` (dark) | `#0d1115` · `#2c343e` | `#000000` · `rgba(255,255,255,.12)` |
| `--bar` (dark) | `#cfd5dc` | `#c9cdd3` |
| `--on-ink` · `--on-ink-muted` | `#e9ecf0` · `#9ea6b1` | `#f7f8f8` · `#9ca3af` |
| `--shadow` | charcoal-tinted | `rgba(8,9,10,…)` in light; a `rgba(255,255,255,.08)` ring in dark |

Choices that are not a straight copy, and why:

- **Dark is pinned.** Analytica has no light mode, so `<html data-theme="dark">`
  in `src/app/layout.tsx` (with `colorScheme: 'dark'` and `themeColor: '#08090a'`)
  and in the prototype makes the app open in that look on any OS. Deleting the
  attribute restores follow-the-OS. The light set was still restyled so the two
  never disagree about brand.
- **Borders are translucent in dark.** Analytica draws every card with a
  `rgba(255,255,255,.08)` hairline instead of a shadow. Keeping the alpha means
  the same token reads correctly on the `#08090a` page, the `#191b1d` card and
  the `#000` hero.
- **`--bar` stays neutral.** The ownership chart uses `--bar`, `--gold`, `--info`
  as three series; making series 1 orange would merge it with series 2.
- **Accent text is darker than the accent.** `#f77d00` on white is 2.7:1, so
  `--gold-deep` is `#b05000` (5.3:1 on white, 4.7:1 on `--surface-2`) wherever
  orange is text on a light card. In dark it lightens to `#ff965f` (8.0:1), the
  same relationship the old gold used.
- **Status colours were checked against their own `-bg`**, not just the page.
  Light: good 5.0:1, warn 5.0:1, bad 5.5:1, info 5.0:1. Dark: good 5.5:1,
  warn 9.3:1, bad 5.4:1, info 6.8:1. Analytica's own red `#d73d3d` reached only
  3.7:1 on a dark chip and was lifted to `#f2625d`.
- **Font is unchanged.** Analytica uses Inter; the request was for colour, and
  IBM Plex Sans is self-hosted and tuned for tabular figures.
- **The design-system page** now shows the dark swatches, since that is what the
  app renders, and its swatch hairline uses `var(--line)` instead of a literal.

## 3.13 Mobile polish: a second additive stylesheet

A mobile audit at ≤840px found places where the markup and the prototype's CSS
disagreed, and places where the prototype hid something with no replacement. The
five verbatim files are untouched (parity still 348/348). Rules the prototype
has no equivalent for live in `src/styles/mobile.css`, imported last.

| Finding | Fix |
| --- | --- |
| Four of the five bottom tabs rendered as links, but `.tabbar button` matches only buttons, so they missed the column layout, label size and gold active icon | `TabBar` renders every tab as a `<button>`, as the prototype does, and navigates with the router. Routes are prefetched on mount |
| `.search{display:none}` left phones with no search at all | A search icon (`.search-toggle`) opens a sheet over the top bar. It focuses the input, reuses the same combobox, and closes on Escape, the scrim, the close button or a chosen result |
| The account menu carried `.hide-m`, as in the prototype, so a tester on a phone could not switch persona | `.hide-m` removed. The prototype's account button was a placeholder; this one holds the NFR-01 persona switcher |
| Notifications, account and search popovers were `absolute` under their button and could clip on a 360px screen | One `.pop` class. Below 840px it pins to the viewport, 12px from each edge, and stops above the tab bar |
| Long tab strips gave no sign they scroll | `Tabs` sets `data-scroll` from its real scroll position, and `mobile.css` fades the overflowing edge. The selected tab scrolls into view |
| A table column with an empty or non-text header printed an unlabelled value on mobile | `DataTable`'s column type now *requires* `mobileLabel` when the header is not text. An empty string header falls back to it |
| Toolbars justified filters and actions apart, and they collided on narrow phones | `.toolbar` actions drop under the filters and share one full-width row with an 8–10px gap |
| Small buttons in stacked table cards and filter pills were 30px tall | Raised to 36px below 840px. Stacked cells wrap |

## 3.12 A second additive stylesheet: the Development Finance workspace

The Development Finance section (see `docs/DEVELOPMENT_FINANCE.md`) needs
things the prototype never drew: a monthly grid with a frozen item column and
frozen summary columns, a project context bar, an invoice document/details
split, a Gantt track and a sensitivity matrix. As with the modal, the rules live
in their own file, `src/styles/finance.css`, imported after `modal.css`; the
five verbatim files are untouched, so §5 still reports 348/348.

| Rule | Reason |
| --- | --- |
| `.ctx-bar` | Project, scenario, model revision, currency, tax basis and freshness (§3.3 of the DF spec) without changing the shared top bar |
| `.fin-wrap`, `.fin-grid`, `.fz`, `.fz-2`, `.fz-3`, `.month` | Sticky item column (260px) and summary columns (128px), 120px months, sticky header, 36px/44px rows |
| `tr.group`, `tr.parent`, `tr.total`, `tr.closing`, `.lvl-N` | Hierarchy by weight, tint *and* the words "· summary" — not weight alone |
| `td.actual` / `th.actual` | Actual months tinted with `--good-bg`, and the header also says "actual" (UI02) |
| `.neg`, `.zero`, `.locked` | Red for outflows with a minus sign; faint dashes for zero; a dot on closed-period figures |
| `.fin-legend` | The visible legend UI02 requires |
| `.doc-split`, `.doc-preview` | 38/62 document/details split, stacking below 1180px (§3.3) |
| `.gantt*` | Programme bars positioned by percentage of the project window |
| `.matrix td.pos/.neg/.base` | Sensitivity cells better/worse than base, base outlined |
| `.nav-sub`, `.nav-toggle` | Revenue and Costs children in the sidebar (§3.1) |

Every colour is an existing token. The DF spec's proposed dark palette (§3.2 —
`#0B0F12`, `#66C5C0` …) was **not** adopted: the app already follows the OS
theme with the prototype's dark tokens, and a second palette would split the
design system. This is recorded as a deliberate deviation in
`docs/DEVELOPMENT_FINANCE.md` §4.

## 4. Deliberate improvements

- **Real routing.** Each screen has a URL, so deep links, browser history and the
  back button work. The prototype swapped `display:none` and stored the last view
  in `localStorage`.
- **Keyboard-accessible table rows** where rows are selectable.
- **Self-hosted fonts** — no third-party request on page load.
- **Server-rendered chrome** — nav badges and the as-of date resolve before paint.
- **Chart tooltips** — `<title>` on each bar gives the month and exact amount.
- **Ownership gap detection generalised** — the prototype hard-coded one gap; the
  app detects both unallocated shares and undecided consolidation methods.
- **Every KPI label is a drill-down link** — the prototype had one placeholder
  "Explain this total"; the app links net worth, assets, liabilities, arrears and
  upcoming obligations to reconciled record lists.
- **Permissions are real** — the prototype's "Can see" column was descriptive
  text; it is now enforced server-side (NFR-01, UAT-04).

## 5. How to re-verify

```bash
# CSS parity
python3 - <<'PY'
orig=open('design/wealth-platform-design.html').read().split('<style>')[1].split('</style>')[0]
parts=[]
for f in ['tokens','base','shell','components','responsive']:
    lines=open(f'src/styles/{f}.css').read().split('\n')
    while lines and not lines[0].strip().endswith('*/'): lines.pop(0)
    lines.pop(0); parts.append('\n'.join(lines))
a=[l for l in orig.split('\n') if l.strip()]
b=[l for l in '\n'.join(parts).split('\n') if l.strip()]
print(len(a), len(b), a==b)
PY

# Every route renders
for p in dashboard obligations bank-import shared-bills expenses loans properties \
         leases entities documents access design-system explain/net-worth; do
  printf "%-24s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/$p)"
done

# No invented CSS classes
npm test   # includes the requirements document's UAT-01…07 scenarios
```

> If new routes appear to 404, a stale `next-server` is probably still bound to
> port 3000. `pkill -f "next start"` does not match it — find it with
> `lsof -i :3000 -sTCP:LISTEN` and kill the PID.
