export interface FinanceLegendItem {
  readonly label: string;
  /** A CSS colour token, e.g. "var(--good-bg)". */
  readonly swatch: string;
}

/**
 * The visible legend the financial screens carry (UI02). Green marks settled
 * activity and amber approved-unpaid activity; whether a variance is favourable
 * is always said in words beside the figure, never implied by a colour.
 */
export function FinanceLegend({ items }: { readonly items: readonly FinanceLegendItem[] }) {
  return (
    <div className="fin-legend" role="list" aria-label="Legend">
      {items.map((item) => (
        <span key={item.label} role="listitem">
          <i style={{ background: item.swatch }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}
