# Holdfast Design System

A portable design language for data-dense financial and operational interfaces:
dashboards, registers, reconciliation screens, admin consoles.

Near-black and orange after analytica.live, IBM Plex Sans, tabular figures
everywhere, and a strict rule that **status is never communicated by colour alone**.

Everything here is self-contained. Copy [§9 — the complete stylesheet](#9-the-complete-stylesheet)
into your project, follow the principles, and you have the system.

---

## Contents

1. [How to adopt it](#1-how-to-adopt-it)
2. [Design principles](#2-design-principles)
3. [Colour](#3-colour)
4. [Typography](#4-typography)
5. [Space, radius, elevation](#5-space-radius-elevation)
6. [Components](#6-components)
7. [Layout and responsive behaviour](#7-layout-and-responsive-behaviour)
8. [Accessibility rules](#8-accessibility-rules)
9. [The complete stylesheet](#9-the-complete-stylesheet)
10. [Adoption checklist](#10-adoption-checklist)

---

## 1. How to adopt it

**Three steps.**

1. Copy the stylesheet from §9 into `styles/`, split into five files in this
   order — `tokens`, `base`, `shell`, `components`, `responsive`. The order is
   the cascade; changing it breaks overrides.
2. Load IBM Plex Sans at weights 400, 500, 600 plus 400 italic. Self-host it
   (`next/font`, `@fontsource`, or local files) rather than hot-linking.
3. Build with the class names in §6. **Do not write new CSS for a component that
   already exists** — compose the existing classes instead.

**The one rule that keeps it coherent:** if a new screen needs a visual treatment
that isn't in §6, add it to the shared component layer *once*, with a class name,
rather than styling inline in a feature. The moment two features style the same
thing differently, the system is gone.

### Naming conventions

| Pattern | Meaning | Example |
| --- | --- | --- |
| `.thing` | The block | `.card`, `.kpi`, `.chip` |
| `.thing-h` / `.thing-b` | Header / body of that block | `.card-h`, `.card-b` |
| `.thing.variant` | A variant | `.chip.good`, `.btn.primary`, `.kpi.accent` |
| `.gN` | Grid of N columns | `.g2`, `.g3`, `.g4` |
| `.num` | Tabular figures | on every number, always |
| `.sub` | Muted secondary text | captions, meta lines |

State lives in ARIA, not in classes: `aria-pressed`, `aria-current`,
`aria-selected`. The CSS keys off those attributes, so the visual state and the
assistive-technology state cannot drift apart.

---

## 2. Design principles

These are the system. The colours are replaceable; these are not.

### Every total carries a date
A number without an as-of date is a claim you can't check. Net worth, valuations
and balances all show when they were true, and anything past its freshness window
is chipped as stale rather than quietly presented as current.

### Every total can be explained
Any headline figure links to the records behind it, down to the source document.
If you can't build that drill-down, the figure probably shouldn't be a headline.

### Status is never colour alone
Every status chip pairs a colour with **an icon and words**. This survives
colour-blindness, greyscale printing, and being screenshotted into a slide deck.
There is no `.chip` variant that is a bare coloured dot, and there shouldn't be.

### Unavailable beats zero
A missing denominator renders "Unavailable", never `0%`. Zero is a measurement;
absence is not. In code this means ratios return a two-state value
(`{available: true, value}` / `{available: false, reason}`) rather than a nullable
number a caller can coerce with `?? 0`.

### Suggestions look different from facts
Anything a model, matcher or heuristic proposed carries a confidence bar and a
Confirm button. Posted records have neither. A user should never have to wonder
whether they're looking at data or a guess.

### Scope is always visible
A persistent pill shows which entities, properties and period the screen covers.
Restricted users see a "limited view" variant, so a partial number never looks
like a total.

### One hero, everything else quiet
Exactly one KPI per screen gets the ink fill. Everything else is a quiet card
with a single accent. Two heroes means no hero.

---

## 3. Colour

The palette follows [analytica.live](https://analytica.live/): a near-black
canvas, charcoal cards defined by hairline borders rather than shadows, off-white
text, and one orange accent reserved for the figures that matter. The app pins
dark mode by default; the light set is the same palette in daylight, kept so the
two never disagree about brand.

### Light

| Token | Hex | Use |
| --- | --- | --- |
| `--ink` | `#08090a` | Sidebar, headings, primary fill |
| `--ink-2` | `#151616` | Sidebar hover |
| `--ink-3` | `#1e1f21` | Active nav |
| `--ink-line` | `#2c2c2c` | Dividers on dark surfaces |
| `--gold` | `#f77d00` | Accent, current indicators, chart series 2 |
| `--gold-deep` | `#b05000` | Accent text on light backgrounds |
| `--gold-soft` | `#fff1e6` | Selected-row wash, avatar background |
| `--on-gold-soft` | `#9a4700` | Text on `--gold-soft` |
| `--bg` | `#f7f8f8` | App canvas |
| `--surface` | `#ffffff` | Cards, tables |
| `--surface-2` | `#f2f3f4` | Hover, inset fields |
| `--line` | `#e5e7eb` | Borders |
| `--line-2` | `#eef0f2` | Internal dividers |
| `--text` | `#08090a` | Body |
| `--text-2` | `#4a4a4a` | Secondary |
| `--muted` | `#6b7280` | Labels, captions |
| `--faint` | `#9ca3af` | Least emphasis, footnotes |
| `--on-ink` | `#f7f8f8` | Text on ink |
| `--on-ink-muted` | `#9ca3af` | Secondary text on ink |

> The accent tokens keep their historical `gold` names — `--gold`, `.chip.gold`,
> `.btn.gold` — even though the colour is now orange. Renaming would touch every
> component file for no visual gain.

### Status

Always used as a **pair** — the foreground for text and icon, the `-bg` for the
chip fill. Every pair below clears 4.5:1 against its own `-bg`.

| Meaning | Token | Hex | `-bg` | Applies to |
| --- | --- | --- | --- | --- |
| Good | `--good` | `#2a7541` | `#e6f4ea` | Paid, current, matched, delivered |
| Warning | `--warn` | `#9a5b00` | `#fff4dd` | Stale, partial, unassigned, blocked |
| Bad | `--bad` | `#b33025` | `#fdecea` | Overdue, failed, reversed |
| Info | `--info` | `#2a63c4` | `#e8f0fb` | Disputed, queued, links |

### Role tokens

These exist so a component never names a raw colour. Change the role, not the
component.

| Token | Light | Purpose |
| --- | --- | --- |
| `--solid` / `--on-solid` | `#08090a` / `#ffffff` | Filled buttons, pressed filters |
| `--hero` / `--on-hero` | `#08090a` / `#f7f8f8` | The one accent KPI |
| `--bar` | `#08090a` | Chart series 1 |
| `--side-bg` | `#08090a` | Sidebar |

### Dark (the app's default)

Dark mode is a **token swap only** — no component CSS changes. It responds to
`prefers-color-scheme` and to an explicit `data-theme` attribute, so a user
toggle wins in both directions. The app sets `data-theme="dark"` on `<html>` in
`src/app/layout.tsx` because analytica.live ships dark only; remove that
attribute (and set `colorScheme: 'light dark'`) to follow the OS again.

| Token | Dark |
| --- | --- |
| `--bg` | `#08090a` |
| `--surface` | `#191b1d` |
| `--surface-2` | `#212326` |
| `--line` / `--line-2` | `rgba(255,255,255,.08)` / `rgba(255,255,255,.05)` — translucent, so one hairline reads on page, card and hero alike |
| `--text` / `--text-2` | `#f7f8f8` / `#c9cdd3` |
| `--muted` / `--faint` | `#9ca3af` / `#6b7280` |
| `--good` / `--warn` / `--bad` / `--info` | `#4caf50` / `#ffbb25` / `#f2625d` / `#6ea8ff` |
| `--good-bg` / `--warn-bg` / `--bad-bg` / `--info-bg` | `#0f2a19` / `#2c2208` / `#33130f` / `#0f1f3a` |
| `--gold` / `--gold-deep` / `--gold-soft` | `#f77d00` / `#ff965f` / `#2b1806` |
| `--solid` / `--on-solid` | `#f7f8f8` / `#08090a` — **inverts** |
| `--hero` / `--hero-line` | `#000000` / `rgba(255,255,255,.12)` — the hero is the darkest thing on screen, ringed rather than filled |
| `--bar` / `--side-bg` | `#c9cdd3` / `#08090a` |

> **Watch the inversion.** In dark mode `--solid` becomes light with dark text.
> Any component hard-coding `#08090a` instead of `var(--solid)` will invert
> incorrectly. This is the most common way the system gets broken.

### Rebranding

To move this to another palette, change **only** `:root` in the tokens layer.
Keep the *relationships*: `--ink` and `--side-bg` equal; `--solid` matching
`--ink` in light and inverting in dark; status foregrounds at 4.5:1 against their
own `-bg`. Component CSS should not need a single edit.

---

## 4. Typography

**IBM Plex Sans**, 400/500/600 plus 400 italic. Base 14px / 1.45.
Stack: `"IBM Plex Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.

Only three weights. 400 body, 500 labels and emphasis, 600 headings and figures.
No 300, no 700 — the scale stays legible at small sizes and the font loads faster.

| Role | Size / weight | Class or element |
| --- | --- | --- |
| KPI value | 28 / 600 | `.kpi-value` (22px ≤840px) |
| Page title | 17 / 600 | `.page-title` |
| Property detail title | 16 / 600 | — |
| Section heading | 15 / 600 | `.section-head h2` |
| Card title | 14 / 600 | `.card-h h3` |
| Body | 14 / 400 | `body` |
| Nav item | 13.5 / 400 | `.nav-item` |
| Table cell | 13 / 400 | `td` |
| Button | 13 / 500 | `.btn` |
| Meta, captions | 12.5 / 400 | `.sub`, `.field label` |
| Table header | 12 / 500 | `th` |
| Chip | 11.5 / 500 | `.chip` |
| Nav group label | 11 / 400 | `.nav-group` |
| Tab bar label | 10.5 / 400 | `.tabbar button` |

### Figures

**Every number gets `.num`.**

```css
.num { font-variant-numeric: tabular-nums lining-nums; letter-spacing: -.01em; }
```

Tabular figures make columns of money align on the decimal without extra markup.
Skipping `.num` on one cell in a table is immediately visible.

Conventions: minus sign is **U+2212** (`−`), not a hyphen. Positive values in
signed contexts (receipts, receivables) take an explicit `+`. Currency uses the
narrow symbol. Whole dollars on KPI tiles; cents in tables and detail panels.

---

## 5. Space, radius, elevation

### Spacing

There is no numeric spacing scale — the system uses a small set of **padding
pairs** tied to component roles. Copy the pair, don't invent one.

| Context | Padding | Notes |
| --- | --- | --- |
| Card header | `14px 18px` | → `14px` horizontal ≤840px |
| Card body | `16px 18px` | → `14px` horizontal ≤840px |
| Table header cell | `10px 18px` | |
| Table body cell | `11px 18px` | |
| List row | `12px 18px` | |
| KPI tile | `16px 18px 14px` | → `13px 14px 12px` ≤840px |
| Content region | `22px 24px 40px` | → `14px 14px (tabbar+24px)` ≤840px |
| Chip | `2px 8px` | |
| Filter pill | `6px 12px` | |
| Button | `0 14px`, height 36px | small: `0 10px`, height 30px |

Grid and stack gaps: **16px** default (`.grid`, `.stack > * + *`), **14px** for
KPI grids, **10px** for KPI grids ≤840px.

### Radius

| Token | Value | Use |
| --- | --- | --- |
| `--r-sm` | `6px` | Chips |
| `--r-md` | `10px` | Banners, swatches, entity icons |
| `--r-lg` | `14px` | Cards, KPI tiles, property cards |
| — | `8px` | Buttons, inputs, nav items, icon buttons |
| — | `20px` | Filter pills |
| — | `50%` | Avatars, timeline dots |

### Elevation

One shadow token. There is no elevation scale — depth is carried by surface
colour and borders, not by stacked shadows.

```css
--shadow: 0 1px 2px rgba(28,33,40,.06), 0 0 0 1px rgba(28,33,40,.04);
/* dark: 0 1px 2px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.05) */
```

The second layer is a hairline border drawn as a shadow, so cards read as edged
rather than floating. Hover on an interactive card adds an accent ring:
`0 0 0 2px var(--gold), var(--shadow)`.

### Layout dimensions

| Token | Value |
| --- | --- |
| `--sidebar` | `248px` |
| `--topbar` | `60px` |
| `--tabbar` | `64px` (mobile only) |
| Content max width | `1440px` |

---

## 6. Components

Each entry gives the class, what it's for, and the rules that matter. Markup is
plain HTML — adapt to any framework.

### Card

Surface container. Header / body / table are siblings, not nested wrappers, so a
table can sit flush against the card edge.

```html
<div class="card">
  <div class="card-h"><h3>Title</h3><span class="sub">Aside</span></div>
  <div class="card-b">…</div>
</div>
```

The header takes a title on the left and *one* of: a link, a chip, a muted
sub-label, or a button row. Not several.

### KPI tile

```html
<div class="kpi accent wide">
  <div class="kpi-label">Net worth <span class="help" title="How this is derived">?</span></div>
  <div class="kpi-value num">$4,821,300<small>as of 6 Sep</small></div>
  <div class="kpi-foot"><span class="delta up">…2.1%</span> vs Jun snapshot</div>
</div>
```

| Variant | Effect |
| --- | --- |
| `.accent` | Ink hero fill. **One per screen.** |
| `.wide` | Spans two grid columns (full width ≤840px) |

`.kpi-value small` is a trailing qualifier inside the number — an as-of date, an
item count, a unit. `.delta` is `up` / `down` / `flat`; flat renders an en-dash,
not a zero. The `.help` affordance is where the derivation rule lives.

### Chip

```html
<span class="chip warn"><svg class="i"><use href="#i-alert"/></svg>3 stale valuations</span>
```

Variants: `good` `warn` `bad` `info` `neutral` `gold`.

**A status chip always has an icon and words.** `neutral` and `gold` are labels
rather than statuses and may omit the icon. `gold` marks selection, not severity.

### Button

```html
<button class="btn primary">Save</button>
<button class="btn gold sm">Confirm</button>
<button class="btn ghost">Cancel</button>
```

| Variant | Use |
| --- | --- |
| *(none)* | Default — bordered, on surface |
| `.primary` | The one committing action on a screen |
| `.gold` | Accepts a suggestion (confirm a match, attach evidence) |
| `.ghost` | Dismissive or tertiary |
| `.sm` | 30px, for table rows and card headers |

Gold specifically means "accept a proposal". Using it for an ordinary save
weakens the suggestion-versus-fact distinction.

### Table

```html
<div class="tbl-wrap">
  <table class="stack-m">
    <thead><tr><th>Tenant</th><th class="r">Due</th></tr></thead>
    <tbody>
      <tr>
        <td class="lead"><span class="tcell-main">A. Nguyen</span><span class="tcell-sub">Room 3</span></td>
        <td class="r num" data-l="Due">$500</td>
      </tr>
    </tbody>
  </table>
</div>
```

- `.tbl-wrap` gives horizontal scroll; the page body must never scroll sideways.
- `.stack-m` collapses each row into a label/value card ≤840px.
- **`data-l` on every cell** supplies the mobile label. Omit it and the mobile
  layout shows a value with no label.
- `.lead` marks the row's primary cell — full width on mobile, no label prefix.
- `.r` right-aligns; pair with `.num` for money.

### Filter pills

```html
<div class="filters" role="group" aria-label="Filter obligations">
  <button class="filter" aria-pressed="true">All <span class="n">23</span></button>
  <button class="filter" aria-pressed="false">Overdue <span class="n">2</span></button>
</div>
```

Selection is `aria-pressed`, not a class. Counts are muted via `.n`. Show a count
only where it's meaningful — a zero-count filter reads as broken.

### Confidence bar

```html
<span class="conf"><span class="bar"><i style="width:94%"></i></span>94%</span>
<span class="conf low"><span class="bar"><i style="width:41%"></i></span>41%</span>
```

Marks machine-proposed values. `.low` switches the fill to amber. Null confidence
renders a zero-width bar and an em-dash — never `0%`.

### Timeline

```html
<ul class="tl">
  <li class="done">Reminder queued<small>Today 08:00 · system</small></li>
  <li class="fail">Delivery failed<small>Email bounce</small></li>
  <li class="next">Send on 9 Sep<small>Status rechecked before sending</small></li>
  <li>Escalate if unpaid<small>Only evidence closes this</small></li>
</ul>
```

States: `done` (green), `fail` (red), `next` (dashed gold), default (hollow).
Used for schedules, audit logs and revision history.

### Stepper

```html
<div class="stepper" aria-label="Import progress">
  <div class="step done"><i>✓</i>Upload</div><div class="step-line done"></div>
  <div class="step cur"><i>2</i>Match</div><div class="step-line"></div>
  <div class="step"><i>3</i>Post</div>
</div>
```

The connector after a step fills only once that step is complete.

### Banner

```html
<div class="banner warn">
  <svg class="i"><use href="#i-alert"/></svg>
  <div><b>3 rows were skipped</b><p>Matched on date, amount and reference.</p></div>
</div>
```

`warn` or `info`. For a condition affecting the whole screen — not per-row
feedback, which belongs in a chip.

### Form field

```html
<div class="field err">
  <label for="bond">Bond</label>
  <input id="bond" value="$1,360.00" aria-invalid="true">
  <span class="hint">Bond policy not approved — record only, no charge generated</span>
</div>
<div class="fgrid">…</div>  <!-- 2 columns, 1 column ≤840px -->
```

Every input has a real `<label for>`. `.err` turns the border and hint red.
**The hint should say what to do, not just what's wrong.**

### Attention strip

```html
<div class="attn" role="group" aria-label="Needs attention">
  <a class="attn-item" href="/properties">
    <div class="attn-ic warn"><svg class="i"><use href="#i-clock"/></svg></div>
    <div><b>3 stale valuations</b><span>Older than 12 months</span></div>
  </a>
</div>
```

Only genuine, actionable gaps. Each item links to where it can be resolved and
disappears once it is. An attention strip that never empties trains people to
ignore it.

### Financial grid (Development Finance)

`FinanceGrid` renders `table.fin-grid` inside `.fin-wrap`: a frozen item
column, up to two frozen summary columns and scrolling month columns. Rows take
a kind (`group`, `parent`, `posting`, `total`, `closing`) that sets weight and
tint, and parents print "· summary" so hierarchy is never weight alone. Month
columns before the actuals cutoff carry `.actual` and the header word
"actual". Money cells are right-aligned tabular figures; a cell with an `href`
is a drill-through link. Pair it with `FinanceLegend`. Styling lives in
`src/styles/finance.css` (see `DESIGN_FIDELITY.md` §3.12).

### Others

| Class | Purpose |
| --- | --- |
| `.prop` | Interactive card with a stat grid and hover ring |
| `.ent` | Row with icon, relationship lines and a right-aligned figure |
| `.list` / `.li-main` / `.li-amt` | Dated list rows |
| `.date-box` | Bordered day/month tile |
| `.avatar` / `.owner` | Person monogram; `.owner.none` is the dashed unassigned state |
| `.tabs` / `.tab` | Underlined tab strip, `aria-selected` |
| `.stat` | `small` label + `b` value + `.meta` caption |
| `.rooms i` | Occupancy strip; `.vac` is dashed |
| `.toast` | Transient bottom-centre confirmation, 2200ms |
| `.swatches` / `.sw` | Palette display |
| `pre.wire` | ASCII layout diagram |
| `.modal` / `.modal-foot` | Native `<dialog>` in the top layer, styled as a `.card`; `.no-print` marks controls the print layout drops. Not in the prototype — see `src/styles/modal.css` and `DESIGN_FIDELITY.md` §3.11. Use the `Modal` component |

### Icons

18px, `stroke-width: 1.75`, `stroke: currentColor`, no fill. Rendered from an SVG
sprite so a colour change is inherited, not re-specified:

```html
<svg class="i"><use href="#i-alert"/></svg>
```

Icons inherit their parent's colour. Never hard-code a stroke colour on one.

---

## 7. Layout and responsive behaviour

### Shell

```
.app  (grid: 248px sidebar + 1fr)
├── .sidebar    sticky, full height, ink
├── .scrim      mobile only, behind the drawer
├── .main
│   ├── .topbar   sticky, 60px
│   └── .content  22px 24px 40px, max-width 1440px
└── .tabbar     mobile only, fixed bottom, 64px
```

### Breakpoints

Four, each with a single job.

| Width | Change |
| --- | --- |
| **≤1320px** | Attention strip wraps to 2×2 |
| **≤1180px** | KPI grid → 2 columns; `.g2` → 1; `.g3`/`.g4` → 2; search narrows |
| **≤840px** | The real break — see below |
| `prefers-reduced-motion` | All transitions disabled |

### Below 840px

- Sidebar becomes a drawer (`min(300px, 86vw)`) over a scrim
- Bottom tab bar appears — 5 destinations, `env(safe-area-inset-bottom)`
- Top bar loses search and the as-of pill; menu button appears. The app adds a
  search icon that opens a full-width search sheet (`src/styles/mobile.css`)
- All grids collapse to one column; hero KPI spans full width
- **Tables become cards** via `.stack-m` + `data-l`
- Content padding drops to 14px, with bottom clearance for the tab bar
- `.hide-m` hides desktop-only affordances

### Grid classes

| Class | ≥1181px | ≤1180px | ≤840px |
| --- | --- | --- | --- |
| `.kpis` | 4 | 2 | 2 |
| `.g2` | 2fr 1fr | 1 | 1 |
| `.g3` | 3 | 2 | 1 |
| `.g4` | 4 | 2 | 1 |

`.g2` is deliberately `2fr 1fr`, not equal halves — it's for a main panel with a
sidebar companion (chart + list, table + detail).

---

## 8. Accessibility rules

Non-negotiable, and cheap if done from the start.

1. **Never colour alone.** Icon + words on every status. Test in greyscale.
2. **ARIA carries state.** `aria-pressed` on filters, `aria-current="page"` on
   nav, `aria-selected` on tabs, `aria-invalid` on failed fields. The CSS keys off
   these attributes, so visual and assistive state can't diverge.
3. **Interactive rows are keyboard-reachable.** A clickable `<tr>` needs
   `tabIndex={0}` and Enter/Space handlers. If it isn't reachable, make it a
   button instead.
4. **Visible focus.** `:focus-visible` is a 2px gold outline with 2px offset.
   Never remove it.
5. **Every input has a real label.** `<label for>` — placeholders are not labels.
6. **Charts have text alternatives.** `role="img"` plus a descriptive
   `aria-label`; `<title>` on individual marks for hover detail.
7. **Icon-only buttons need `aria-label`.**
8. **Respect reduced motion.** Already handled by the media query.
9. **Announce transient messages.** The toast is `role="status" aria-live="polite"`.
10. **Never scroll the body sideways.** Wide content scrolls inside its own
    container.

Target: WCAG 2.2 AA. The status pairs and text tokens meet 4.5:1 in both themes;
verify again after any palette change.

---

## 9. The complete stylesheet

Split into five files in this order. Concatenated it is ~350 lines.


### `tokens.css`

Colour, type, spacing and layout tokens. **This is the only file you edit to rebrand.**

```css
/* ---------- Tokens (palette after analytica.live: near-black #08090a, charcoal surfaces, hairline borders, orange #f77d00 accent) ---------- */
:root{
  --ink:#08090a;        /* site theme colour — sidebar, headings */
  --ink-2:#151616;
  --ink-3:#1e1f21;
  --ink-line:#2c2c2c;
  --gold:#f77d00;       /* accent — the orange analytica.live puts on highlighted figures */
  --gold-deep:#b05000;
  --gold-soft:#fff1e6;
  --bg:#f7f8f8;
  --surface:#ffffff;
  --surface-2:#f2f3f4;
  --line:#e5e7eb;
  --line-2:#eef0f2;
  --text:#08090a;
  --text-2:#4a4a4a;
  --muted:#6b7280;
  --faint:#9ca3af;
  --good:#2a7541;   --good-bg:#e6f4ea;
  --warn:#9a5b00;   --warn-bg:#fff4dd;
  --bad:#b33025;    --bad-bg:#fdecea;
  --info:#2a63c4;   --info-bg:#e8f0fb;
  --on-ink:#f7f8f8;
  --on-ink-muted:#9ca3af;
  --solid:#08090a; --on-solid:#ffffff;     /* filled buttons, pressed filters */
  --hero:#08090a; --on-hero:#f7f8f8; --hero-line:transparent;
  --bar:#08090a;                            /* chart bars */
  --side-bg:#08090a;
  --on-gold-soft:#9a4700;                   /* text on gold-soft (avatars, gold chips) */
  --shadow:0 1px 2px rgba(8,9,10,.06), 0 0 0 1px rgba(8,9,10,.05);
  --r-sm:6px; --r-md:10px; --r-lg:14px;
  --sidebar:248px;
  --topbar:60px;
  --tabbar:64px;
  --font:"IBM Plex Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#08090a; --surface:#191b1d; --surface-2:#212326; --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.05);
    --text:#f7f8f8; --text-2:#c9cdd3; --muted:#9ca3af; --faint:#6b7280;
    --good-bg:#0f2a19; --warn-bg:#2c2208; --bad-bg:#33130f; --info-bg:#0f1f3a; --gold-soft:#2b1806;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08);
    --good:#4caf50; --warn:#ffbb25; --bad:#f2625d; --info:#6ea8ff;
    --gold:#f77d00; --gold-deep:#ff965f; --on-gold-soft:#ffb27a;
    --solid:#f7f8f8; --on-solid:#08090a; --hero:#000000; --on-hero:#f7f8f8; --hero-line:rgba(255,255,255,.12); --bar:#c9cdd3; --side-bg:#08090a;
    --on-ink:#f7f8f8; --on-ink-muted:#9ca3af;
  }
}
:root[data-theme="dark"]{
  --bg:#08090a; --surface:#191b1d; --surface-2:#212326; --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.05);
  --text:#f7f8f8; --text-2:#c9cdd3; --muted:#9ca3af; --faint:#6b7280;
  --good-bg:#0f2a19; --warn-bg:#2c2208; --bad-bg:#33130f; --info-bg:#0f1f3a; --gold-soft:#2b1806;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08);
    --good:#4caf50; --warn:#ffbb25; --bad:#f2625d; --info:#6ea8ff;
    --gold:#f77d00; --gold-deep:#ff965f; --on-gold-soft:#ffb27a;
    --solid:#f7f8f8; --on-solid:#08090a; --hero:#000000; --on-hero:#f7f8f8; --hero-line:rgba(255,255,255,.12); --bar:#c9cdd3; --side-bg:#08090a;
    --on-ink:#f7f8f8; --on-ink-muted:#9ca3af;
}
```

### `base.css`

Element resets and the shared `.num` / `.sr` / `svg.i` helpers.

```css
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:var(--font);font-size:14px;line-height:1.45;color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer;background:none;border:0;padding:0}
a{color:var(--info);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:4px}
.num{font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.01em}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
svg.i{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
```

### `shell.css`

Sidebar, top bar and content region.

```css
/* ---------- Shell ---------- */
.app{display:grid;grid-template-columns:var(--sidebar) 1fr;min-height:100vh}
.sidebar{background:var(--side-bg);color:var(--on-ink);position:sticky;top:0;height:100vh;display:flex;flex-direction:column;z-index:30}
.brand{display:flex;align-items:center;gap:10px;padding:18px 20px 14px;border-bottom:1px solid var(--ink-line)}
.brand-mark{width:30px;height:30px;border-radius:8px;background:var(--gold);display:grid;place-items:center;color:var(--ink);font-weight:600;font-size:15px}
.brand-name{font-weight:600;font-size:15px;letter-spacing:.01em}
.brand-sub{display:block;font-size:11px;color:var(--on-ink-muted)}
.scope{margin:14px 14px 6px;background:var(--ink-2);border:1px solid var(--ink-line);border-radius:var(--r-md);padding:10px 12px;display:flex;align-items:center;gap:10px;width:calc(100% - 28px);text-align:left;color:var(--on-ink)}
.scope small{display:block;font-size:11px;color:var(--on-ink-muted)}
.scope strong{font-weight:500;font-size:13px}
.scope svg{margin-left:auto;color:var(--on-ink-muted)}
.nav{padding:8px 10px;overflow:auto;flex:1}
.nav-group{margin:8px 0 6px;padding:0 10px;font-size:11px;color:var(--on-ink-muted);letter-spacing:.02em}
.nav-item{display:flex;align-items:center;gap:11px;width:100%;padding:9px 10px;border-radius:8px;color:var(--on-ink);font-size:13.5px;text-align:left}
.nav-item:hover{background:var(--ink-2)}
.nav-item[aria-current="page"]{background:var(--ink-3);color:#fff;box-shadow:inset 3px 0 0 var(--gold)}
.nav-item .count{margin-left:auto;font-size:11px;background:var(--ink-3);padding:1px 7px;border-radius:10px;color:var(--on-ink-muted)}
.nav-item[aria-current="page"] .count{background:var(--gold);color:var(--ink)}
.side-foot{padding:12px 14px;border-top:1px solid var(--ink-line);display:flex;align-items:center;gap:10px;font-size:12px}
.avatar{width:30px;height:30px;border-radius:50%;background:var(--gold-soft);color:var(--on-gold-soft);display:grid;place-items:center;font-weight:600;font-size:12px;flex:none}
.side-foot .role{color:var(--on-ink-muted);display:block;font-size:11px}
.scrim{display:none;position:fixed;inset:0;background:rgba(28,33,40,.5);z-index:25}

.main{min-width:0;display:flex;flex-direction:column}
.topbar{height:var(--topbar);display:flex;align-items:center;gap:12px;padding:0 24px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.menu-btn{display:none;width:38px;height:38px;border-radius:8px;place-items:center}
.menu-btn:hover{background:var(--surface-2)}
.page-title{font-size:17px;font-weight:600;margin:0}
.asof{display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;color:var(--text-2);background:var(--surface)}
.asof b{font-weight:500;color:var(--text)}
.search{margin-left:auto;display:flex;align-items:center;gap:8px;padding:0 12px;height:36px;width:280px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--muted)}
.search input{border:0;background:none;width:100%;outline:none}
.icon-btn{width:36px;height:36px;border-radius:8px;display:grid;place-items:center;color:var(--text-2);position:relative}
.icon-btn:hover{background:var(--surface-2)}
.icon-btn .dot{position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--bad);border:2px solid var(--surface)}

.content{padding:22px 24px 40px;max-width:1440px;width:100%}
.view{display:none}
.view.active{display:block}
```

### `components.css`

Every component in §6.

```css
/* ---------- Building blocks (Zoho-style) ---------- */
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 10px}
.section-head h2{font-size:15px;font-weight:600;margin:0}
.section-head a,.section-head .sub{font-size:12.5px}
.sub{color:var(--muted)}
.card{background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow)}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line-2)}
.card-h h3{margin:0;font-size:14px;font-weight:600}
.card-b{padding:16px 18px}
.grid{display:grid;gap:16px}
.grid>*{min-width:0}
.card{min-width:0}
.g2{grid-template-columns:2fr 1fr}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
.stack>*+*{margin-top:16px}

/* KPI tiles */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi{background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:16px 18px 14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.kpi-label{font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:6px}
.kpi-label .help{color:var(--faint);display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;border:1px solid var(--line);font-size:10px}
.kpi-value{font-size:28px;font-weight:600;line-height:1.1;color:var(--text)}
.kpi-value small{font-size:15px;font-weight:500;color:var(--muted);margin-left:2px}
.kpi-foot{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);flex-wrap:wrap}
.delta{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;font-weight:500;font-size:11.5px}
.delta svg{width:12px;height:12px}
.up{background:var(--good-bg);color:var(--good)}
.down{background:var(--bad-bg);color:var(--bad)}
.flat{background:var(--surface-2);color:var(--muted)}
.kpi.wide{grid-column:span 2}
.kpi.accent{background:var(--hero);color:var(--on-hero);box-shadow:0 0 0 1px var(--hero-line)}
.kpi.accent .kpi-label,.kpi.accent .kpi-foot{color:var(--on-ink-muted)}
.kpi.accent .kpi-value{color:#fff}
.kpi.accent .kpi-value small{color:var(--gold)}
.kpi.accent .help{border-color:var(--ink-line);color:var(--on-ink-muted)}
.kpi-link{font-size:12px;color:var(--gold-deep)}
.kpi.accent .kpi-link{color:var(--gold)}

/* Status chips: always icon + text, never colour alone */
.chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;font-size:11.5px;font-weight:500;white-space:nowrap}
.chip svg{width:12px;height:12px}
.chip.good{background:var(--good-bg);color:var(--good)}
.chip.warn{background:var(--warn-bg);color:var(--warn)}
.chip.bad{background:var(--bad-bg);color:var(--bad)}
.chip.info{background:var(--info-bg);color:var(--info)}
.chip.neutral{background:var(--surface-2);color:var(--text-2);border:1px solid var(--line)}
.chip.gold{background:var(--gold-soft);color:var(--on-gold-soft)}

/* Attention strip */
.attn{display:flex;gap:0;background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden}
.attn-item{flex:1;display:flex;align-items:center;gap:12px;padding:12px 18px;border-right:1px solid var(--line-2);min-width:0;text-align:left;color:var(--text)}
.attn-item:last-child{border-right:0}
.attn-item:hover{background:var(--surface-2)}
.attn-ic{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;flex:none}
.attn-ic.warn{background:var(--warn-bg);color:var(--warn)}
.attn-ic.bad{background:var(--bad-bg);color:var(--bad)}
.attn-ic.info{background:var(--info-bg);color:var(--info)}
.attn-item>div:last-child{min-width:0;flex:1}
.attn-item b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.attn-item b{display:block;font-weight:600;font-size:14px}
.attn-item span{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}

/* Tables */
.tbl-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:10px 18px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:11px 18px;border-bottom:1px solid var(--line-2);vertical-align:middle}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--surface-2)}
td.r,th.r{text-align:right}
.tcell-main{font-weight:500;white-space:nowrap}
.tcell-sub{font-size:12px;color:var(--muted);display:block}
.btn{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:8px;font-weight:500;font-size:13px;border:1px solid var(--line);background:var(--surface);color:var(--text);white-space:nowrap}
.btn:hover{background:var(--surface-2)}
.btn.primary{background:var(--solid);color:var(--on-solid);border-color:var(--solid)}
.btn.primary:hover{opacity:.9}
.btn.gold{background:var(--gold);color:var(--ink);border-color:var(--gold)}
.btn.sm{height:30px;padding:0 10px;font-size:12.5px}
.btn.ghost{border-color:transparent;background:transparent;color:var(--text-2)}
.btn.ghost:hover{background:var(--surface-2)}

/* Filters */
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.filter{padding:6px 12px;border-radius:20px;border:1px solid var(--line);background:var(--surface);font-size:12.5px;color:var(--text-2)}
.filter[aria-pressed="true"]{background:var(--solid);color:var(--on-solid);border-color:var(--solid)}
.filter .n{opacity:.7;margin-left:4px}

/* Lists */
.list{list-style:none;margin:0;padding:0}
.list li{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--line-2);min-width:0}
.list li>*{flex:none}
.list li>.li-main{flex:1}
.list li:last-child{border-bottom:0}
.date-box{width:44px;flex:none;text-align:center;border:1px solid var(--line);border-radius:8px;padding:4px 0;line-height:1.1}
.date-box b{display:block;font-size:16px;font-weight:600}
.date-box span{font-size:10.5px;color:var(--muted)}
.li-main{flex:1;min-width:0}
.li-main b{font-weight:500;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.li-main span{font-size:12px;color:var(--muted);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.li-amt{font-weight:600;white-space:nowrap}
.owner{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2)}
.owner .avatar{width:22px;height:22px;font-size:10px}
.owner.none .avatar{background:var(--warn-bg);color:var(--warn);border:1px dashed var(--warn)}

/* Chart */
.chart{width:100%;height:auto;display:block}
.legend{display:flex;gap:16px;font-size:12px;color:var(--muted)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}

/* Property cards */
.prop{background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:16px 18px;display:flex;flex-direction:column;gap:12px;text-align:left;color:var(--text);width:100%}
.prop:hover{box-shadow:0 0 0 2px var(--gold), var(--shadow)}
.prop-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.prop-top b{font-weight:600;font-size:14px;display:block}
.prop-top span{font-size:12px;color:var(--muted)}
.prop-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
.stat small{display:block;font-size:11.5px;color:var(--muted)}
.stat b{font-weight:600;font-size:15px}
.stat .meta{font-size:11px;color:var(--faint);display:block}
.rooms{display:flex;gap:4px}
.rooms i{width:18px;height:8px;border-radius:2px;background:var(--good)}
.rooms i.vac{background:var(--line);border:1px dashed var(--faint)}

/* Tabs */
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto}
.tab{padding:10px 14px;font-size:13px;color:var(--muted);border-bottom:2px solid transparent;white-space:nowrap}
.tab[aria-selected="true"]{color:var(--text);border-bottom-color:var(--gold);font-weight:500}

/* Stepper */
.stepper{display:flex;align-items:center;gap:0;overflow-x:auto;padding:4px 0}
.step{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);white-space:nowrap}
.step i{width:24px;height:24px;border-radius:50%;border:1.5px solid var(--line);display:grid;place-items:center;font-style:normal;font-size:11.5px;font-weight:600}
.step.done i{background:var(--good);border-color:var(--good);color:#fff}
.step.cur{color:var(--text);font-weight:500}
.step.cur i{background:var(--gold);border-color:var(--gold);color:var(--ink)}
.step-line{width:40px;height:1.5px;background:var(--line);margin:0 8px;flex:none}
.step-line.done{background:var(--good)}

.banner{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:var(--r-md);font-size:13px}
.banner.warn{background:var(--warn-bg);color:var(--warn)}
.banner.info{background:var(--info-bg);color:var(--info)}
.banner b{display:block;font-weight:600}
.banner p{margin:2px 0 0;color:inherit;opacity:.9}
.conf{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.conf .bar{width:54px;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.conf .bar i{display:block;height:100%;background:var(--good)}
.conf.low .bar i{background:var(--warn)}

/* Timeline */
.tl{list-style:none;margin:0;padding:0 0 0 4px;border-left:2px solid var(--line);}
.tl li{position:relative;padding:0 0 14px 18px;font-size:13px}
.tl li::before{content:"";position:absolute;left:-7px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--surface);border:2px solid var(--muted)}
.tl li.done::before{background:var(--good);border-color:var(--good)}
.tl li.fail::before{background:var(--bad);border-color:var(--bad)}
.tl li.next::before{border-color:var(--gold);border-style:dashed}
.tl small{display:block;color:var(--muted);font-size:12px}

/* Entities */
.ent{display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid var(--line-2)}
.ent:last-child{border-bottom:0}
.ent-ic{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;flex:none;font-weight:600;font-size:12px}
.ent-ic.person{background:var(--info-bg);color:var(--info)}
.ent-ic.company{background:var(--gold-soft);color:var(--on-gold-soft)}
.ent-ic.trust{background:var(--good-bg);color:var(--good)}
.ent-ic.smsf{background:var(--surface-2);color:var(--text-2);border:1px solid var(--line)}
.ent-main{flex:1;min-width:0}
.ent-main b{font-weight:600;display:block}
.ent-main .rel{font-size:12.5px;color:var(--text-2);margin-top:4px}
.ent-main .rel span{display:inline-block;margin-right:10px}
.ent-side{text-align:right;flex:none}
.ent-side b{display:block;font-weight:600}
.ent-side span{font-size:12px;color:var(--muted)}

/* Forms */
.field{display:flex;flex-direction:column;gap:5px}
.field label{font-size:12.5px;color:var(--text-2);font-weight:500}
.field input,.field select{height:38px;border:1px solid var(--line);border-radius:8px;padding:0 12px;background:var(--surface);color:var(--text)}
.field input:focus,.field select:focus{outline:2px solid var(--gold);outline-offset:0;border-color:var(--gold)}
.field .hint{font-size:12px;color:var(--muted)}
.field.err input{border-color:var(--bad)}
.field.err .hint{color:var(--bad)}
.fgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}

/* Design system view */
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.sw{border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow);background:var(--surface)}
.sw i{display:block;height:64px}
.sw div{padding:8px 10px;font-size:12px}
.sw b{display:block;font-weight:600;font-size:12.5px}
.type-row{display:flex;align-items:baseline;gap:16px;padding:10px 0;border-bottom:1px solid var(--line-2)}
.type-row small{width:180px;flex:none;color:var(--muted);font-size:12px}
.ds-note{font-size:13px;color:var(--text-2);margin:0}
.ds-note+.ds-note{margin-top:8px}
.frames{display:grid;grid-template-columns:1fr 1fr;gap:16px}
pre.wire{margin:0;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-md);padding:12px;font-size:11.5px;line-height:1.35;overflow-x:auto;color:var(--text-2)}

/* Bottom tab bar (mobile) */
.tabbar{display:none}

/* Toast */
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:var(--solid);color:var(--on-solid);padding:10px 16px;border-radius:10px;font-size:13px;opacity:0;pointer-events:none;transition:.25s;z-index:60;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
```

### `responsive.css`

The four breakpoints. Must load last.

```css
/* ---------- Responsive ---------- */
@media (max-width:1320px){
  .attn{flex-wrap:wrap}
  .attn-item{flex:1 1 45%;border-bottom:1px solid var(--line-2)}
  .attn-item:nth-child(2n){border-right:0}
  .attn-item:nth-last-child(-n+2){border-bottom:0}
}
@media (max-width:1180px){
  .kpis{grid-template-columns:repeat(2,1fr)}
  .g2{grid-template-columns:1fr}
  .g3{grid-template-columns:repeat(2,1fr)}
  .g4{grid-template-columns:repeat(2,1fr)}
  .search{width:200px}
  .frames{grid-template-columns:1fr}
}
@media (max-width:840px){
  .app{grid-template-columns:1fr}
  .sidebar{position:fixed;left:0;top:0;bottom:0;width:min(300px,86vw);transform:translateX(-102%);transition:transform .22s ease}
  .sidebar.open{transform:none}
  .scrim.show{display:block}
  .menu-btn{display:grid}
  .topbar{padding:0 14px;gap:8px}
  .search{display:none}
  .asof{display:none}
  .page-title{font-size:16px}
  .content{padding:14px 14px calc(var(--tabbar) + 24px)}
  .kpis{grid-template-columns:repeat(2,1fr);gap:10px}
  .kpi{padding:13px 14px 12px}
  .kpi-value{font-size:22px}
  .kpi.wide{grid-column:1/-1}
  .attn{flex-direction:column}
  .attn-item{border-right:0;border-bottom:1px solid var(--line-2)}
  .attn-item:last-child{border-bottom:0}
  .g3,.g4{grid-template-columns:1fr}
  .fgrid{grid-template-columns:1fr}
  .card-h,.card-b{padding-left:14px;padding-right:14px}
  th,td{padding-left:14px;padding-right:14px}
  .list li{padding-left:14px;padding-right:14px}
  .tabbar{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;left:0;right:0;bottom:0;height:var(--tabbar);background:var(--surface);border-top:1px solid var(--line);z-index:30;padding-bottom:env(safe-area-inset-bottom)}
  .tabbar button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10.5px;color:var(--muted)}
  .tabbar button[aria-current="page"]{color:var(--text);font-weight:500}
  .tabbar button[aria-current="page"] svg{color:var(--gold-deep)}
  .tabbar svg.i{width:22px;height:22px}
  .hide-m{display:none !important}
  /* Tables turn into cards on small screens */
  table.stack-m thead{display:none}
  table.stack-m,table.stack-m tbody,table.stack-m tr,table.stack-m td{display:block;width:100%}
  table.stack-m tr{padding:10px 14px;border-bottom:1px solid var(--line-2)}
  table.stack-m td{padding:3px 0;border:0;display:flex;justify-content:space-between;gap:12px;text-align:left}
  table.stack-m td.r{text-align:right}
  table.stack-m td::before{content:attr(data-l);color:var(--muted);font-size:12px;flex:none}
  table.stack-m td.lead{display:block;padding-bottom:6px}
  table.stack-m td.lead::before{display:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
```

### Entry point

```css
/* styles/globals.css — order is the cascade, do not reorder */
@import './tokens.css';
@import './base.css';
@import './shell.css';
@import './components.css';
@import './responsive.css';
```

If you self-host the font through a build tool that generates a CSS variable,
bind it in a sixth file loaded straight after `tokens.css`:

```css
:root {
  --font: var(--font-ibm-plex-sans), "IBM Plex Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
```

---

## 10. Adoption checklist

Before you ship a screen built on this system:

- [ ] Exactly **one** `.kpi.accent` on the screen
- [ ] Every number carries `.num`
- [ ] Every status chip has an icon **and** words
- [ ] Every table cell has `data-l`, and the primary cell has `.lead`
- [ ] Every total has a visible as-of date
- [ ] Every headline total links to a drill-down that reconciles to it
- [ ] Missing ratios render "Unavailable", never `0%`
- [ ] Machine suggestions carry a confidence bar and a Confirm action
- [ ] Selection state is in ARIA, not only in a class
- [ ] Interactive rows are keyboard-reachable with visible focus
- [ ] Checked at 375px, 840px, 1180px and 1440px
- [ ] Checked in dark mode — nothing hard-codes `#08090a` instead of `var(--solid)`
- [ ] Checked in greyscale — every status still readable
- [ ] No new CSS written for a component that already exists

### Anti-patterns

| Don't | Why | Instead |
| --- | --- | --- |
| A bare coloured dot for status | Fails colour-blindness and greyscale | `.chip` with icon and words |
| `0%` for a missing ratio | Reads as measured-and-fine | "Unavailable" plus the reason |
| Two accent KPIs | Nothing is the hero | One `.accent`, the rest quiet |
| Hard-coded `#08090a` | Inverts wrongly in dark mode | `var(--solid)` or `var(--ink)` |
| A number without `.num` | Breaks decimal alignment in a column | Always `.num` |
| A table cell without `data-l` | Mobile shows an unlabelled value | Always supply it |
| Styling a one-off inline in a feature | The system fragments | Add it to the component layer once |
| `.btn.gold` for an ordinary save | Weakens suggestion-vs-fact | `.btn.primary` |
| New spacing values | The rhythm drifts | Reuse a padding pair from §5 |
| Removing `:focus-visible` | Makes keyboard use impossible | Keep the gold outline |

---

## Provenance

Extracted from the Holdfast wealth & property platform, whose stylesheet was
ported verbatim from an HTML design prototype and verified byte-identical
(348/348 rule lines). The palette follows analytica.live: near-black `#08090a`,
charcoal surfaces, hairline borders and an orange `#f77d00` accent.

Free to reuse. Swap `:root` in `tokens.css` for your own brand and keep
everything else.
