import type { ReactNode } from 'react';

export interface FinanceGridColumn {
  readonly key: string;
  readonly header: ReactNode;
  /** Second header line, e.g. "actual" / "forecast" — words, not colour alone (UI02). */
  readonly subheader?: ReactNode;
  /** Tooltip defining the column's basis (CF01). */
  readonly title?: string;
  readonly align?: 'left' | 'right';
  /** Frozen summary columns after the item column: 1 = first, 2 = second. */
  readonly frozen?: 1 | 2;
  /** A month column at or before the actuals cutoff. */
  readonly actual?: boolean;
  readonly month?: boolean;
}

export interface FinanceGridCell {
  readonly content: ReactNode;
  /** Drill-through destination (CF05). Rendered as a link so it works without JavaScript. */
  readonly href?: string;
  readonly negative?: boolean;
  readonly zero?: boolean;
  /** Imported or closed-period figure — read only, marked with a dot. */
  readonly locked?: boolean;
  readonly title?: string;
}

export type FinanceGridRowKind = 'group' | 'parent' | 'posting' | 'total' | 'closing' | 'plain';

export interface FinanceGridRow {
  readonly id: string;
  readonly label: ReactNode;
  readonly kind: FinanceGridRowKind;
  /** Indentation level 0–3. */
  readonly level?: number;
  readonly cells: Readonly<Record<string, FinanceGridCell | undefined>>;
  readonly labelHref?: string;
}

export interface FinanceGridProps {
  readonly columns: readonly FinanceGridColumn[];
  readonly rows: readonly FinanceGridRow[];
  readonly itemHeader?: ReactNode;
  readonly density?: 'compact' | 'comfortable';
  readonly caption: string;
  readonly empty?: ReactNode;
}

/**
 * The financial grid (CF01, §3.3): a frozen item column, up to two frozen
 * summary columns, and months that scroll horizontally. Group, parent, posting
 * and total rows carry their kind as a class *and* as text ("· summary"), so
 * hierarchy is not conveyed by weight alone. Styling lives in
 * `src/styles/finance.css`.
 */
export function FinanceGrid({ columns, rows, itemHeader = 'Item', density = 'compact', caption, empty }: FinanceGridProps) {
  if (rows.length === 0 && empty) {
    return (
      <div className="card-b">
        <p className="sub" style={{ margin: 0 }}>
          {empty}
        </p>
      </div>
    );
  }
  const className = density === 'comfortable' ? 'fin-grid comfortable' : 'fin-grid';

  return (
    <div className="fin-wrap">
      <table className={className}>
        <caption className="sr">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="fz">
              {itemHeader}
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={columnClass(column)} title={column.title}>
                {column.header}
                {column.subheader ? <small>{column.subheader}</small> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.kind === 'plain' ? undefined : row.kind}>
              <th scope="row" className={['fz', row.level ? `lvl-${Math.min(row.level, 3)}` : ''].filter(Boolean).join(' ')} style={{ fontWeight: 'inherit', color: 'inherit', position: 'sticky', left: 0 }}>
                {row.labelHref ? (
                  <a className="cell" href={row.labelHref}>
                    {row.label}
                  </a>
                ) : (
                  row.label
                )}
              </th>
              {columns.map((column) => {
                const cell = row.cells[column.key];
                const classes = [
                  columnClass(column),
                  cell?.negative ? 'neg' : '',
                  cell?.zero ? 'zero' : '',
                  cell?.locked ? 'locked' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td key={column.key} className={classes || undefined} title={cell?.title}>
                    {cell ? (
                      cell.href ? (
                        <a className="cell num" href={cell.href} title={cell.title ?? 'Show what makes up this figure'}>
                          {cell.content}
                        </a>
                      ) : (
                        <span className="num">{cell.content}</span>
                      )
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function columnClass(column: FinanceGridColumn): string | undefined {
  const classes = [
    column.align === 'left' ? '' : 'r',
    column.frozen === 1 ? 'fz fz-2' : column.frozen === 2 ? 'fz fz-3' : '',
    column.actual ? 'actual' : '',
    column.month ? 'month' : '',
  ].filter(Boolean);
  return classes.length > 0 ? classes.join(' ') : undefined;
}
