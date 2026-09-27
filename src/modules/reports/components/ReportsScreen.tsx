'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionForm } from '@/shared/components/ActionForm';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub } from '@/shared/components/DataTable';
import { FieldGrid, SelectField } from '@/shared/components/Field';
import { Row, Stack, Sub } from '@/shared/components/Layout';
import { Banner } from '@/shared/components/Banner';
import type { ActionResult } from '@/shared/lib/action-result';
import { downloadLinkAction, generateReportAction, retryReportAction } from '../actions';
import { REPORT_TEMPLATE_LABELS, type ReportJobState, type ReportTemplate } from '../model';

export interface ReportRow {
  readonly id: string;
  readonly template: ReportTemplate;
  readonly state: ReportJobState;
  readonly createdAt: string;
  readonly createdByName: string;
  readonly modelRevision: number | null;
  readonly basis: string;
  readonly error: string | null;
  readonly investorCopy: boolean;
}

export interface ReportsScreenProps {
  readonly projectId: string;
  readonly jobs: readonly ReportRow[];
  readonly templates: readonly ReportTemplate[];
  readonly scenarios: readonly { readonly id: string; readonly name: string }[];
  readonly canExport: boolean;
  readonly canIncludeSensitive: boolean;
  readonly initialTemplate: ReportTemplate | null;
}

const STATE_CHIP: Record<ReportJobState, { tone: 'good' | 'bad' | 'info' | 'neutral'; icon: 'i-check' | 'i-alert' | 'i-clock' }> = {
  completed: { tone: 'good', icon: 'i-check' },
  failed: { tone: 'bad', icon: 'i-alert' },
  running: { tone: 'info', icon: 'i-clock' },
  queued: { tone: 'neutral', icon: 'i-clock' },
};

/** RPT01–RPT04 — generate, view, print and download frozen report snapshots. */
export function ReportsScreen({ projectId, jobs, templates, scenarios, canExport, canIncludeSensitive, initialTemplate }: ReportsScreenProps) {
  const [template, setTemplate] = useState<ReportTemplate>(initialTemplate && templates.includes(initialTemplate) ? initialTemplate : (templates[0] ?? 'feasibility-summary'));
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const base = `/projects/${encodeURIComponent(projectId)}/reports`;

  const linkAction = async (previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> => {
    const result = await downloadLinkAction(previous, form);
    if (result.ok && result.value) setLink(result.value as { url: string; expiresAt: string });
    return result;
  };

  return (
    <Stack>
      {canExport ? (
        <Card>
          <CardHeader title="Generate a report" aside={<Sub>CSV plus a printable view · PDF and XLSX are Release 2</Sub>} />
          <CardBody>
            <ActionForm action={generateReportAction} submitLabel="Generate" hiddenFields={{ projectId }}>
              {() => (
                <FieldGrid>
                  <SelectField
                    id="rp-template" name="template" label="Report" value={template} onChange={(event) => setTemplate(event.target.value as ReportTemplate)}
                    options={templates.map((value) => ({ value, label: REPORT_TEMPLATE_LABELS[value] }))}
                  />
                  <SelectField id="rp-basis" name="basis" label="Tax basis" options={[{ value: '', label: 'Project default' }, { value: 'economic', label: 'Economic · net of recoverable GST' }, { value: 'gross', label: 'Gross · cash including GST' }]} />
                  {template === 'scenario-comparison' ? (
                    <div className="field" style={{ gridColumn: '1 / -1' }}>
                      <label htmlFor="rp-scenarios">Scenarios (up to three)</label>
                      <div className="row" id="rp-scenarios">
                        {scenarios.map((scenario) => (
                          <label key={scenario.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                            <input type="checkbox" name="scenarioIds" value={scenario.id} /> {scenario.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {canIncludeSensitive ? (
                    <SelectField id="rp-sensitive" name="includeSensitive" label="Supplier and buyer details" options={[{ value: '', label: 'Withhold (default)' }, { value: 'on', label: 'Include — authorised recipients only' }]} />
                  ) : null}
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        </Card>
      ) : (
        <Banner tone="info" title="Exporting needs the export grant on this project">
          You can open reports that have already been generated for you.
        </Banner>
      )}

      {link ? (
        <Banner tone="info" icon="i-upload" title="Download link ready">
          <a href={link.url} download>Download CSV</a> · valid until {link.expiresAt.replace('T', ' ').slice(0, 16)} UTC and only for you.
        </Banner>
      ) : null}

      <Card>
        <CardHeader title="Report snapshots" aside={<Sub>Each is frozen at the model revision it was generated from</Sub>} />
        <DataTable
          columns={[
            {
              header: 'Report',
              lead: true,
              render: (row: ReportRow) => (
                <>
                  <CellMain>{row.state === 'completed' ? <Link href={`${base}/${encodeURIComponent(row.id)}`}>{REPORT_TEMPLATE_LABELS[row.template]}</Link> : REPORT_TEMPLATE_LABELS[row.template]}</CellMain>
                  <CellSub>{row.createdAt.replace('T', ' ').slice(0, 16)} UTC · {row.createdByName}{row.investorCopy ? ' · investor copy' : ''}</CellSub>
                </>
              ),
            },
            {
              header: 'State',
              render: (row: ReportRow) => (
                <Chip tone={STATE_CHIP[row.state].tone} icon={STATE_CHIP[row.state].icon}>
                  {row.state}{row.error ? ` · ${row.error}` : ''}
                </Chip>
              ),
            },
            { header: 'Model rev', align: 'right', render: (row: ReportRow) => <span className="num">{row.modelRevision ?? '–'}</span> },
            { header: 'Basis', render: (row: ReportRow) => row.basis },
            {
              header: 'Actions',
              render: (row: ReportRow) => (
                <Row>
                  {row.state === 'completed' ? (
                    <>
                      <Link className="btn sm" href={`${base}/${encodeURIComponent(row.id)}`}>Open & print</Link>
                      {canExport ? <ActionForm action={linkAction} submitLabel="Download CSV" render="inline" hiddenFields={{ reportId: row.id }} /> : null}
                    </>
                  ) : null}
                  {row.state === 'failed' && canExport ? <ActionForm action={retryReportAction} submitLabel="Retry" render="inline" hiddenFields={{ reportId: row.id }} /> : null}
                </Row>
              ),
            },
          ]}
          rows={jobs}
          rowKey={(row) => row.id}
          empty="No reports generated yet."
        />
      </Card>
      <Sub style={{ fontSize: 12 }}>
        Exports keep numeric values and currency codes, neutralise spreadsheet formulas in typed text, and state the project, scenario,
        model version, engine version, actuals cutoff, generation time and tax basis. Regenerating from an unchanged model gives the same figures.
      </Sub>
    </Stack>
  );
}
