'use client';

import Link from 'next/link';
import { ActionForm } from '@/shared/components/ActionForm';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { FieldGrid, TextField } from '@/shared/components/Field';
import { Grid, Row, Stack, Stat, Sub } from '@/shared/components/Layout';
import { Timeline } from '@/shared/components/Timeline';
import { commentReportAction } from '../actions';
import { REPORT_TEMPLATE_LABELS, type ReportJob } from '../model';

export interface ReportViewProps {
  readonly projectId: string;
  readonly job: ReportJob;
  readonly commentAuthors: Readonly<Record<string, string>>;
  readonly canComment: boolean;
}

/** The printable report (RPT02 R1) with its snapshot facts and comments (RPT04). */
export function ReportView({ projectId, job, commentAuthors, canComment }: ReportViewProps) {
  const meta = job.meta;
  return (
    <Stack>
      <Row>
        <Link className="btn sm no-print" href={`/projects/${encodeURIComponent(projectId)}/reports`}>← All reports</Link>
        <Button small onClick={() => window.print()}>Print</Button>
      </Row>
      <Card>
        <CardHeader title={REPORT_TEMPLATE_LABELS[job.template]} aside={<Sub>Frozen snapshot · figures never change after generation</Sub>} />
        {meta ? (
          <CardBody>
            <Grid columns={4}>
              <Stat label="Project" value={`${meta.projectCode} · ${meta.projectName}`} />
              <Stat label="Scenario" value={meta.scenarioLabel} />
              <Stat label="Model / engine" value={`rev ${meta.modelRevision} · ${meta.engineVersion}`} />
              <Stat label="Actuals cutoff" value={meta.actualsCutoff} />
              <Stat label="Tax basis" value={meta.taxBasis} />
              <Stat label="Generated" value={meta.generatedAt.replace('T', ' ').slice(0, 16)} meta="UTC" />
              <Stat label="Data hash" value={job.dataHash?.slice(0, 12) ?? '–'} meta="Identical for an unchanged snapshot" />
              <Stat label="Currency" value="AUD" />
            </Grid>
          </CardBody>
        ) : null}
      </Card>
      {(job.tables ?? []).map((table) => (
        <Card key={table.title}>
          <CardHeader title={table.title} />
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>{table.header.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.length === 0 ? (
                  <tr><td colSpan={table.header.length}><Sub>No rows.</Sub></td></tr>
                ) : (
                  table.rows.map((row, r) => (
                    <tr key={r}>{row.map((cell, c) => <td key={c} className={/^-?\d+\.\d+$/.test(cell) ? 'r num' : undefined}>{cell}</td>)}</tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <Card>
        <CardHeader title="Comments" aside={<Sub>Appended; the report itself is unchanged</Sub>} />
        <CardBody className="stack">
          <Timeline
            entries={job.comments.map((comment) => ({
              id: comment.id,
              state: 'done',
              title: comment.text,
              meta: `${commentAuthors[comment.by] ?? 'Unknown'} · ${comment.at.replace('T', ' ').slice(0, 16)}${comment.attachmentName ? ` · attachment: ${comment.attachmentName}` : ''}`,
            }))}
          />
          {job.comments.length === 0 ? <Sub>No comments yet.</Sub> : null}
          {canComment ? (
            <div className="no-print">
              <ActionForm action={commentReportAction} submitLabel="Add comment" hiddenFields={{ reportId: job.id }}>
                {() => (
                  <FieldGrid>
                    <TextField id="rc-text" name="text" label="Comment" required />
                    <TextField id="rc-att" name="attachmentName" label="Attachment name (optional)" hint="Files are not stored in this build; the name is recorded." />
                  </FieldGrid>
                )}
              </ActionForm>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </Stack>
  );
}
