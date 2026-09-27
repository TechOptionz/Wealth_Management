'use client';

import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Sub } from '@/shared/components/Layout';
import { addMonths, daysBetween, formatDateShort, maxDate, startOfMonth } from '@/shared/lib/dates';
import type { ProgrammeRow } from '../api';

export interface ProgrammeGanttProps {
  readonly rows: readonly ProgrammeRow[];
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * PRG01 — the programme on a time axis. Rows are positioned as a percentage of
 * the project window (start → expected completion, widened when a date falls
 * later). The prototype's `.gantt` classes do the styling.
 */
export function ProgrammeGantt({ rows, windowStart, windowEnd, selectedId, onSelect }: ProgrammeGanttProps) {
  const end = rows.reduce((latest, row) => maxDate(latest, maxDate(row.plannedDate, row.actualDate ?? row.plannedDate)), windowEnd);
  const total = Math.max(1, daysBetween(windowStart, end));
  const pct = (date: string): number => Math.min(100, Math.max(0, (daysBetween(windowStart, date) / total) * 100));

  // One label every three months, spaced evenly by the axis' flex layout.
  const ticks: string[] = [];
  for (let cursor = startOfMonth(windowStart); cursor <= end; cursor = addMonths(cursor, 3)) {
    const date = new Date(`${cursor}T00:00:00Z`);
    ticks.push(`${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`);
  }

  return (
    <Card>
      <CardHeader title="Gantt" aside={<Sub>{formatDateShort(windowStart)} → {formatDateShort(end)}</Sub>} />
      <CardBody style={{ padding: 0 }}>
        <div className="gantt-axis" style={{ padding: '10px 18px 0' }}>
          <div />
          <div>
            {ticks.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
        </div>
        <div className="gantt" role="list">
          {rows.map((row) => {
            const start = row.plannedStart ?? row.plannedDate;
            const left = pct(start);
            const width = Math.max(0.6, pct(row.plannedDate) - left);
            const barClass = ['gantt-bar', row.actualDate ? 'actual' : '', row.late ? 'late' : ''].filter(Boolean).join(' ');
            const title = `${row.name} · ${row.plannedStart ? `${row.plannedStart} → ` : ''}${row.plannedDate}${row.actualDate ? ` · actual ${row.actualDate}` : ''}`;
            return (
              <div
                key={row.id}
                className={row.kind === 'stage' ? 'gantt-row stage' : 'gantt-row'}
                role="listitem"
                tabIndex={0}
                aria-current={row.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(row.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(row.id);
                  }
                }}
                style={{ cursor: 'pointer', background: row.id === selectedId ? 'var(--gold-soft)' : undefined, borderRadius: 6 }}
              >
                <span style={{ paddingLeft: row.depth * 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.kind === 'stage' ? <b>{row.name}</b> : row.name}
                </span>
                <div className="gantt-track" title={title} aria-label={title}>
                  {row.kind === 'milestone' ? (
                    <>
                      {row.late && !row.actualDate ? <span className={barClass} style={{ left: `${left}%`, width: '0.6%' }} /> : null}
                      <span className="gantt-mark" style={{ left: `calc(${pct(row.effectiveDate)}% - 5px)`, ...(row.actualDate ? { background: 'var(--good)' } : {}) }} />
                    </>
                  ) : (
                    <span className={barClass} style={{ left: `${left}%`, width: `${width}%` }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
