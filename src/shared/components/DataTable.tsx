import type { CSSProperties, ReactNode } from 'react';

interface DataTableColumnBase<TRow> {
  readonly align?: 'left' | 'right';
  /**
   * Marks the row's primary column. On mobile it becomes the card's heading
   * (full width, no label prefix) — the design's `td.lead` behaviour.
   */
  readonly lead?: boolean;
  readonly render: (row: TRow) => ReactNode;
}

/**
 * A column either has a text header, which doubles as the mobile label, or a
 * non-text header (an icon, or nothing at all for an actions column) and then
 * *must* say in words what it holds — otherwise the ≤840px card layout prints
 * an unlabelled value. The type makes the second case a compile error.
 */
export type DataTableColumn<TRow> = DataTableColumnBase<TRow> &
  (
    | {
        /** Header text. Also emitted as each cell's `data-l`, which drives the mobile card layout. */
        readonly header: string;
        /** Short label for the mobile `label: value` layout when the header is long (or empty). */
        readonly mobileLabel?: string;
      }
    | {
        readonly header: Exclude<ReactNode, string>;
        readonly mobileLabel: string;
      }
  );

export interface DataTableProps<TRow> {
  readonly columns: readonly DataTableColumn<TRow>[];
  readonly rows: readonly TRow[];
  readonly rowKey: (row: TRow) => string;
  /** Optional per-row style — used to highlight the selected obligation. */
  readonly rowStyle?: (row: TRow) => CSSProperties | undefined;
  /**
   * Makes rows selectable. Supplying this adds keyboard access and the correct
   * ARIA role, so a clickable row is not a mouse-only affordance.
   */
  readonly onRowClick?: (row: TRow) => void;
  /** Marks the currently-selected row for assistive technology. */
  readonly isRowSelected?: (row: TRow) => boolean;
  /** Message shown when there are no rows. */
  readonly empty?: ReactNode;
}

/**
 * The design's table pattern: horizontally scrollable on desktop, and on
 * screens ≤840px each row collapses into a label/value card via `table.stack-m`.
 * Cells carry `data-l` so the mobile layout can print its own labels.
 */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  rowStyle,
  empty,
  onRowClick,
  isRowSelected,
}: DataTableProps<TRow>) {
  if (rows.length === 0 && empty) {
    return (
      <div className="card-b">
        <p className="sub" style={{ margin: 0 }}>
          {empty}
        </p>
      </div>
    );
  }

  return (
    <div className="tbl-wrap">
      <table className="stack-m">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} className={column.align === 'right' ? 'r' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              style={onRowClick ? { cursor: 'pointer', ...rowStyle?.(row) } : rowStyle?.(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              aria-selected={isRowSelected ? isRowSelected(row) : undefined}
            >
              {columns.map((column, index) => {
                // An empty header is no label at all; fall through to `mobileLabel` or nothing.
                const label =
                  column.mobileLabel ?? (typeof column.header === 'string' && column.header !== '' ? column.header : undefined);
                const className = [column.lead ? 'lead' : '', column.align === 'right' ? 'r' : '']
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td key={index} className={className || undefined} data-l={column.lead ? undefined : label}>
                    {column.render(row)}
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

/** Primary cell text — the bold first line of a table row. */
export function CellMain({ children }: { readonly children: ReactNode }) {
  return <span className="tcell-main">{children}</span>;
}

/** Secondary cell text — the muted second line beneath a `CellMain`. */
export function CellSub({ children }: { readonly children: ReactNode }) {
  return <span className="tcell-sub">{children}</span>;
}

/** Right-aligned tabular figure. */
export function Num({ children, style }: { readonly children: ReactNode; readonly style?: CSSProperties }) {
  return (
    <span className="num" style={style}>
      {children}
    </span>
  );
}
