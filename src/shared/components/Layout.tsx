import type { CSSProperties, ReactNode } from 'react';

/** Vertical rhythm container — children are separated by the standard 16px gap. */
export function Stack({ children, style }: { readonly children: ReactNode; readonly style?: CSSProperties }) {
  return (
    <div className="stack" style={style}>
      {children}
    </div>
  );
}

/** Horizontal flex row with wrapping, used for toolbars and button groups. */
export function Row({ children, style }: { readonly children: ReactNode; readonly style?: CSSProperties }) {
  return (
    <div className="row" style={style}>
      {children}
    </div>
  );
}

export type GridColumns = 2 | 3 | 4;

/** Responsive grid. `columns` maps to the design's .g2/.g3/.g4 breakpointed layouts. */
export function Grid({
  columns,
  children,
  style,
}: {
  readonly columns?: GridColumns;
  readonly children: ReactNode;
  readonly style?: CSSProperties;
}) {
  return (
    <div className={columns ? `grid g${columns}` : 'grid'} style={style}>
      {children}
    </div>
  );
}

/**
 * Toolbar pattern: a filter group on the left, a primary action on the right.
 * Below 840px (`.toolbar` in src/styles/mobile.css) the actions drop under the
 * filters and share one full-width row, so nothing collides on a phone.
 */
export function Toolbar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="row toolbar" style={{ justifyContent: 'space-between' }}>
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  aside,
}: {
  readonly title: ReactNode;
  readonly aside?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {aside}
    </div>
  );
}

/** Muted secondary text. */
export function Sub({ children, style }: { readonly children: ReactNode; readonly style?: CSSProperties }) {
  return (
    <span className="sub" style={style}>
      {children}
    </span>
  );
}

/** A small label/value pair used in detail panels and property cards. */
export function Stat({
  label,
  value,
  meta,
  valueStyle,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly meta?: ReactNode;
  readonly valueStyle?: CSSProperties;
}) {
  return (
    <div className="stat">
      <small>{label}</small>
      <b style={valueStyle}>{value}</b>
      {meta ? <span className="meta">{meta}</span> : null}
    </div>
  );
}
