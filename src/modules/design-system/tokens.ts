/**
 * Design-system reference data.
 *
 * The single place where the palette, type scale and UI rules are described for
 * humans. Values mirror the dark set in `src/styles/tokens.css` — the set the app
 * renders, since it pins `data-theme="dark"` — and that file remains the source
 * of truth. The palette follows analytica.live: near-black canvas, charcoal cards
 * with hairline borders, off-white text and one orange accent.
 */

export interface Swatch {
  readonly name: string;
  readonly hex: string;
  readonly usage: string;
  /** Light swatches need a hairline so they read against the card. */
  readonly needsBorder?: boolean;
}

export const PALETTE: readonly Swatch[] = [
  { name: 'Canvas', hex: '#08090a', usage: 'page and sidebar', needsBorder: true },
  { name: 'Surface', hex: '#191b1d', usage: 'cards, tables', needsBorder: true },
  { name: 'Surface 2', hex: '#212326', usage: 'hover, inset fields', needsBorder: true },
  { name: 'Orange', hex: '#f77d00', usage: 'accent, current indicators' },
  { name: 'Orange light', hex: '#ff965f', usage: 'accent text on cards' },
  { name: 'Text', hex: '#f7f8f8', usage: 'body, filled buttons' },
  { name: 'Muted', hex: '#9ca3af', usage: 'labels, captions' },
  { name: 'Good', hex: '#4caf50', usage: 'paid, current, matched' },
  { name: 'Warn', hex: '#ffbb25', usage: 'stale, partial, unassigned' },
  { name: 'Bad', hex: '#f2625d', usage: 'overdue, failed' },
  { name: 'Info', hex: '#6ea8ff', usage: 'disputed, queued, links' },
];

/** The rules the interface follows, stated so they survive a hand-off. */
export const UI_RULES: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: 'Every total carries a date.',
    body: 'Net worth, valuations and loan balances show their as-of date beside the number; anything older than 12 months is chipped as stale.',
  },
  {
    title: 'Every total can be explained.',
    body: 'KPI tiles link to a drill-down that lists the records behind the figure, down to the source document.',
  },
  {
    title: 'Status is never colour alone.',
    body: 'Each chip has an icon and words, so it survives colour-blindness and greyscale printing (NFR-07).',
  },
  {
    title: 'Unavailable beats zero.',
    body: 'A missing denominator shows “Unavailable”, never 0%.',
  },
  {
    title: 'Suggestions look different from facts.',
    body: 'Confidence bars and “Confirm” buttons mark anything a model or matcher proposed; posted records have neither.',
  },
  {
    title: 'Scope is always visible.',
    body: 'The sidebar scope pill shows which entities, properties and period the screen covers; restricted users see a “limited view” variant.',
  },
  {
    title: 'One hero, everything else quiet.',
    body: 'Only the primary KPI gets the ink fill; every other tile is a quiet card with a single accent so the eye lands in one place.',
  },
];

export const DESKTOP_WIREFRAME = `DESKTOP  (sidebar 248px + fluid content, max 1440px)
┌──────────┬────────────────────────────────────────────┐
│ Holdfast │ ≡ Page title   As of 6 Sep · AUD   🔍  🔔 JS│
│ [Scope ▾]├────────────────────────────────────────────┤
│ Overview │ ┌────────────┐┌─────┐┌─────┐┌─────┐        │
│ ● Dash   │ │ NET WORTH  ││KPI  ││KPI  ││KPI  │ ← 4-col│
│   Oblig  │ └────────────┘└─────┘└─────┘└─────┘   grid │
│ Money    │ [ needs-attention strip: 4 items ]         │
│   Bank   │ ┌─────────────────────┐┌──────────────┐    │
│   Loans  │ │ chart (2fr)         ││ due list(1fr)│    │
│ Property │ └─────────────────────┘└──────────────┘    │
│   Props  │ ┌─────────────────────┐┌──────────────┐    │
│   Leases │ │ arrears table       ││ ownership    │    │
│ …        │ └─────────────────────┘└──────────────┘    │
│ JS owner │                                            │
└──────────┴────────────────────────────────────────────┘`;

export const MOBILE_WIREFRAME = `MOBILE  (single column, bottom tab bar, drawer nav)
┌──────────────────────────┐
│ ≡  Dashboard         🔔  │  ← top bar: menu, title, bell
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │ NET WORTH (full row) │ │  ← hero tile spans both cols
│ └──────────────────────┘ │
│ ┌──────────┐┌──────────┐ │
│ │ Assets   ││ Liabs    │ │  ← 2-col KPI grid
│ └──────────┘└──────────┘ │
│ [ attention items stack ]│
│ [ chart, full width ]    │
│ [ due list ]             │
│ [ arrears as cards ]     │  ← tables become label:value cards
│ …                        │
├──────────────────────────┤
│ Home  Money  Prop  Tasks More │  ← 5 tabs, 64px, safe-area
└──────────────────────────┘
Drawer (≡) opens the full grouped sidebar over a scrim.`;
