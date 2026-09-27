'use client';

import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Grid, Row, Stack, Stat, Sub } from '@/shared/components/Layout';
import { Timeline } from '@/shared/components/Timeline';
import { formatMoney, type Money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import { TAX_TREATMENT_LABELS } from '@/shared/finance-engine';
import type { InvoiceDetail, InvoicesWorkspace } from '../api';
import { SETTLEMENT_TYPE_LABELS } from '../model';
import {
  addInvoiceCommentAction,
  addRetentionAction,
  decideInvoiceAction,
  dismissSimilarityAction,
  holdInvoiceAction,
  markReadyAction,
  overrideDuplicateAction,
  releaseHoldAction,
  submitInvoiceAction,
  updateInvoiceAction,
  voidInvoiceAction,
} from '../actions';
import { AllocationsEditor, centsToInput, toCents } from './AllocationsEditor';
import { ReviewStateChip, SettlementChip, SyncChip } from './chips';

const fmt = (value: Money): string => formatMoney(value, { showCents: true });

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** INV05 — everything a reviewer needs on one screen, with the document beside the fields. */
export function InvoiceReview({ detail, workspace }: { readonly detail: InvoiceDetail; readonly workspace: InvoicesWorkspace }) {
  const { permissions } = workspace;
  const [net, setNet] = useState(centsToInput(detail.net));
  const [tax, setTax] = useState(centsToInput(detail.tax));
  const editable = permissions.canCapture && detail.reviewState !== 'void';
  const unresolvedFindings = detail.findings.filter((finding) => !finding.resolved);

  return (
    <div className="doc-split">
      <div className="doc-preview" role="img" aria-label="Document preview unavailable">
        <div>
          {detail.intake ? (
            <>
              <b>{detail.intake.filename}</b>
              {sizeLabel(detail.intake.sizeBytes)} · {detail.intake.mimeType}
              <br />
              sha256 {detail.intake.checksum ? `${detail.intake.checksum.slice(0, 16)}…` : 'not taken (no bytes supplied)'}
              <br />
              Origin: {detail.intake.origin} · received {formatDateLong(detail.intake.receivedAt.slice(0, 10))} · checks {detail.intake.scanState}
            </>
          ) : (
            <>
              <b>No document attached</b>
              Entered manually
            </>
          )}
          <p style={{ marginTop: 12 }}>Preview unavailable · files are not stored in this build</p>
        </div>
      </div>

      <Stack>
        <Card>
          <CardHeader
            title={`${detail.type === 'credit-note' ? 'Credit note' : 'Invoice'} ${detail.number}`}
            aside={
              <Row>
                <ReviewStateChip state={detail.reviewState} />
                <SettlementChip state={detail.settlement.state} />
                <SyncChip approved={detail.reviewState === 'approved'} />
              </Row>
            }
          />
          <CardBody>
            <Grid columns={4}>
              <Stat label="Supplier" value={detail.supplierName} meta={detail.submittedByName ? `Submitted by ${detail.submittedByName}` : 'Not yet submitted'} />
              <Stat label="Invoice date" value={formatDateLong(detail.invoiceDate)} meta={`Due ${formatDateLong(detail.dueDate)}`} />
              <Stat label="Payment month" value={formatDateLong(detail.expectedPaymentDate)} meta={detail.scheduledPaymentDate ? 'Scheduled at approval' : 'Due date'} />
              <Stat
                label="Revision"
                value={`${detail.revisionNumber} of ${detail.revisionCount}`}
                meta={detail.approvedRevisionNumber ? `Approved revision ${detail.approvedRevisionNumber} · frozen` : 'Not approved'}
              />
              <Stat label="Net" value={fmt(detail.net)} />
              <Stat label="GST" value={fmt(detail.tax)} meta={detail.roundingAdjustment.cents !== 0 ? `Rounding ${fmt(detail.roundingAdjustment)}` : undefined} />
              <Stat label="Gross" value={fmt(detail.gross)} meta="AUD" />
              <Stat label="Accounting" value="Not synced" meta={detail.externalAuthorisation ? `External: ${detail.externalAuthorisation}` : 'No accounting connection'} />
            </Grid>
          </CardBody>
        </Card>

        {detail.holdReason ? <Banner tone="warn" icon="i-pause" title="On hold">{detail.holdReason}</Banner> : null}
        {detail.rejectReason ? <Banner tone="warn" icon="i-x" title="Rejected">{detail.rejectReason} · correct the invoice to resubmit it as a new revision.</Banner> : null}
        {detail.voidReason ? <Banner tone="warn" icon="i-x" title="Void · record kept">{detail.voidReason}</Banner> : null}
        {detail.issues.length > 0 && detail.reviewState !== 'void' ? (
          <Banner tone="warn" title="Needs attention before it can be ready">{detail.issues.join(' ')}</Banner>
        ) : null}
        {detail.warnings.length > 0 ? (
          <Banner tone={detail.warningsCleared ? 'info' : 'warn'} title={detail.warningsCleared ? 'Warnings acknowledged' : 'Warnings'}>
            {detail.warnings.map((warning) => warning.label).join(' · ')}
          </Banner>
        ) : null}

        <Card>
          <CardHeader title="Cost and stage allocations" aside={<Sub>Σ net and GST must equal the invoice (INV06)</Sub>} />
          <DataTable
            columns={[
              { header: 'Cost line', lead: true, render: (row: InvoiceDetail['allocations'][number]) => <CellMain>{row.costLineLabel}</CellMain> },
              {
                header: 'Commitment',
                render: (row: InvoiceDetail['allocations'][number]) =>
                  row.commitmentLabel ? (
                    row.commitmentLabel
                  ) : (
                    <Chip tone={row.allowanceTreatment ? 'info' : 'warn'} icon={row.allowanceTreatment ? 'i-check' : 'i-alert'}>
                      {row.allowanceTreatment === 'additional-scope' ? 'Direct · additional scope' : row.allowanceTreatment === 'consume-allowance' ? 'Direct · consumes allowance' : 'Direct · choose treatment'}
                    </Chip>
                  ),
              },
              { header: 'Tax', render: (row: InvoiceDetail['allocations'][number]) => TAX_TREATMENT_LABELS[row.taxTreatment] },
              { header: 'Net', align: 'right', render: (row: InvoiceDetail['allocations'][number]) => <span className="num">{fmt(row.net)}</span> },
              { header: 'GST', align: 'right', render: (row: InvoiceDetail['allocations'][number]) => <span className="num">{fmt(row.tax)}</span> },
            ]}
            rows={detail.allocations}
            rowKey={(row) => row.id}
            empty="Not yet coded to a cost line."
          />
        </Card>

        {detail.commitmentPositions.map((entry) => (
          <Card key={entry.commitmentId}>
            <CardHeader title={`Commitment ${entry.reference} · remaining`} aside={<Sub>Gross, including GST (CST05)</Sub>} />
            <CardBody>
              <Grid columns={3}>
                <Stat label="Contract total" value={fmt(entry.position.contractTotal)} />
                <Stat label="Invoiced to date" value={fmt(entry.position.invoicedToDate)} />
                <Stat label="Paid to date" value={fmt(entry.position.paidToDate)} />
                <Stat label="Approved unpaid" value={fmt(entry.position.approvedUnpaid)} />
                <Stat label="Uninvoiced balance" value={fmt(entry.position.uninvoicedBalance)} />
                <Stat label="Remaining estimate" value={fmt(entry.position.remainingEstimate)} />
              </Grid>
            </CardBody>
          </Card>
        ))}

        {detail.findings.length > 0 ? (
          <Card>
            <CardHeader title="Duplicate checks" aside={<Chip tone={unresolvedFindings.length ? 'bad' : 'good'} icon={unresolvedFindings.length ? 'i-alert' : 'i-check'}>{unresolvedFindings.length ? `${unresolvedFindings.length} unresolved` : 'Resolved'}</Chip>} />
            <CardBody className="stack">
              {detail.findings.map((finding) => (
                <div key={`${finding.kind}-${finding.invoiceId}`} className="stack">
                  <Row>
                    <Chip tone={finding.resolved ? 'neutral' : finding.kind === 'similar' ? 'warn' : 'bad'} icon={finding.resolved ? 'i-check' : 'i-alert'}>
                      {finding.kind === 'exact' ? 'Exact number match' : finding.kind === 'checksum' ? 'Same file' : 'Similar amount and date'}
                    </Chip>
                    <Sub>Matches {finding.number}{finding.resolved ? ' · resolved' : ''}</Sub>
                  </Row>
                  {!finding.resolved && finding.kind !== 'similar' && permissions.canPay ? (
                    <ActionForm action={overrideDuplicateAction} submitLabel="Record override" submitVariant="default" hiddenFields={{ invoiceId: detail.id, suspectInvoiceId: finding.invoiceId }}>
                      {({ fieldErrors }) => (
                        <TextField id={`ovr-${finding.invoiceId}`} name="reason" label="Override reason (linked to the suspected duplicate)" required invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                      )}
                    </ActionForm>
                  ) : null}
                  {!finding.resolved && finding.kind !== 'similar' && !permissions.canPay ? (
                    <Sub>Only a finance user with payment authority may override an exact or same-file duplicate.</Sub>
                  ) : null}
                  {!finding.resolved && finding.kind === 'similar' && permissions.canCapture ? (
                    <ActionForm action={dismissSimilarityAction} submitLabel="Dismiss warning" submitVariant="default" hiddenFields={{ invoiceId: detail.id, suspectInvoiceId: finding.invoiceId }}>
                      {({ fieldErrors }) => (
                        <TextField id={`dis-${finding.invoiceId}`} name="reason" label="Why this is not a duplicate" required invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                      )}
                    </ActionForm>
                  ) : null}
                </div>
              ))}
              {detail.duplicateOverride ? <Sub>Override by {detail.duplicateOverride.byName}: {detail.duplicateOverride.reason} (linked to {detail.duplicateOverride.suspectNumber})</Sub> : null}
              {detail.dismissedSimilarity ? <Sub>Similarity dismissed by {detail.dismissedSimilarity.byName}: {detail.dismissedSimilarity.reason}</Sub> : null}
            </CardBody>
          </Card>
        ) : null}

        {detail.reviewState === 'awaiting-approval' ? (
          <Card>
            <CardHeader title="Decision" aside={<Sub>Revision {detail.revisionNumber} · gross {fmt(detail.gross)}</Sub>} />
            <CardBody className="stack">
              {detail.approveBlocker && detail.holdBlocker ? (
                <Banner tone="info" icon="i-shield" title="You cannot decide this invoice">{detail.holdBlocker}</Banner>
              ) : (
                <>
                  {detail.approveBlocker ? <Banner tone="info" icon="i-shield" title="Approve is unavailable to you">{detail.approveBlocker} You may still hold or reject it.</Banner> : null}
                  <ActionForm
                    action={decideInvoiceAction}
                    submitLabel="Record decision"
                    hiddenFields={{ invoiceId: detail.id, revisionId: detail.currentRevisionId }}
                    footnote={<Sub style={{ fontSize: 12 }}>Approval is recorded locally and shown as “Approved · not synced · no accounting connection”. It never marks the invoice paid.</Sub>}
                  >
                    {({ fieldErrors }) => (
                      <FieldGrid>
                        <SelectField
                          id={`dec-${detail.id}`}
                          name="decision"
                          label="Decision"
                          options={[
                            ...(detail.approveBlocker ? [] : [{ value: 'approved', label: 'Approve' }]),
                            { value: 'on-hold', label: 'Hold' },
                            { value: 'rejected', label: 'Reject' },
                          ]}
                        />
                        <TextField id={`dec-date-${detail.id}`} name="scheduledPaymentDate" label="Scheduled payment date" type="date" defaultValue={detail.scheduledPaymentDate ?? detail.dueDate} />
                        <TextField id={`dec-reason-${detail.id}`} name="reason" label="Reason (required to hold or reject)" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                      </FieldGrid>
                    )}
                  </ActionForm>
                </>
              )}
            </CardBody>
          </Card>
        ) : null}

        {editable ? (
          <Card>
            <CardHeader title="Workflow" aside={<Sub>Received → needs review → ready → awaiting approval → decision</Sub>} />
            <CardBody className="stack">
              {detail.reviewState === 'needs-review' || detail.reviewState === 'received' || detail.reviewState === 'ready' ? (
                <ActionForm action={submitInvoiceAction} submitLabel="Submit for approval" hiddenFields={{ invoiceId: detail.id }}>
                  {() =>
                    detail.warnings.length > 0 && !detail.warningsCleared ? (
                      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <input type="checkbox" name="acknowledgeWarnings" /> I have reviewed the warnings above
                      </label>
                    ) : null
                  }
                </ActionForm>
              ) : null}
              {detail.reviewState === 'needs-review' ? (
                <ActionForm action={markReadyAction} submitLabel="Mark ready only" submitVariant="default" hiddenFields={{ invoiceId: detail.id }}>
                  {() =>
                    detail.warnings.length > 0 && !detail.warningsCleared ? (
                      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <input type="checkbox" name="acknowledgeWarnings" /> Acknowledge warnings (future or closed-period dates need payment authority)
                      </label>
                    ) : null
                  }
                </ActionForm>
              ) : null}
              {detail.reviewState === 'on-hold' ? (
                <ActionForm action={releaseHoldAction} submitLabel="Release hold · revalidate" render="inline" submitVariant="default" hiddenFields={{ invoiceId: detail.id }} />
              ) : null}
              {['needs-review', 'ready', 'awaiting-approval', 'received'].includes(detail.reviewState) ? (
                <ActionForm action={holdInvoiceAction} submitLabel="Put on hold" submitVariant="default" hiddenFields={{ invoiceId: detail.id }}>
                  {({ fieldErrors }) => (
                    <TextField id={`hold-${detail.id}`} name="reason" label="Hold reason" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                  )}
                </ActionForm>
              ) : null}
              {permissions.canPay ? (
                <ActionForm action={voidInvoiceAction} submitLabel="Void invoice" submitVariant="ghost" hiddenFields={{ invoiceId: detail.id }}>
                  {({ fieldErrors }) => (
                    <TextField id={`void-${detail.id}`} name="reason" label="Void reason · the record is kept" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                  )}
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {editable ? (
          <Card>
            <CardHeader
              title={detail.reviewState === 'approved' ? 'Correct the approved invoice' : 'Invoice fields'}
              aside={<Sub>{detail.reviewState === 'approved' ? 'A material change creates a new revision needing renewed approval; the approved one stays frozen' : 'Extraction is manual in this build'}</Sub>}
            />
            <CardBody>
              <ActionForm
                key={detail.currentRevisionId}
                action={updateInvoiceAction}
                submitLabel={detail.reviewState === 'approved' ? 'Save correction' : 'Save changes'}
                hiddenFields={{ invoiceId: detail.id, revision: String(workspace.modelRevision) }}
              >
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <SelectField id={`e-sup-${detail.id}`} name="supplierId" label="Supplier" defaultValue={detail.supplierId} options={workspace.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
                    <TextField id={`e-num-${detail.id}`} name="number" label="Number" defaultValue={detail.number} invalid={Boolean(firstError(fieldErrors, 'number'))} hint={firstError(fieldErrors, 'number')} />
                    <TextField id={`e-date-${detail.id}`} name="invoiceDate" label="Invoice date" type="date" defaultValue={detail.invoiceDate} />
                    <TextField id={`e-due-${detail.id}`} name="dueDate" label="Due date" type="date" defaultValue={detail.dueDate} />
                    <TextField id={`e-net-${detail.id}`} name="net" label="Net (ex GST)" inputMode="decimal" value={net} onChange={(event) => setNet(event.target.value)} />
                    <TextField id={`e-tax-${detail.id}`} name="tax" label="GST" inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} />
                    <TextField id={`e-round-${detail.id}`} name="roundingAdjustment" label="Rounding adjustment (max ±0.01)" inputMode="decimal" defaultValue={centsToInput(detail.roundingAdjustment)} />
                    <TextField id={`e-sched-${detail.id}`} name="scheduledPaymentDate" label="Scheduled payment date" type="date" defaultValue={detail.scheduledPaymentDate ?? ''} />
                    <TextField id={`e-desc-${detail.id}`} name="lineDescription" label="Description" defaultValue={detail.lineDescriptions[0] ?? ''} />
                    <AllocationsEditor
                      idPrefix={`e-${detail.id}`}
                      initial={detail.allocations.map((row) => ({
                        costLineId: row.costLineId,
                        commitmentId: row.commitmentId ?? '',
                        stageId: row.stageId ?? '',
                        net: centsToInput(row.net),
                        tax: centsToInput(row.tax),
                        treatment: row.taxTreatment,
                        allowance: row.allowanceTreatment ?? '',
                      }))}
                      costLines={workspace.costLines}
                      commitments={workspace.commitmentOptions}
                      invoiceNet={toCents(net)}
                      invoiceTax={toCents(tax)}
                      invalid={firstError(fieldErrors, 'allocations')}
                    />
                  </FieldGrid>
                )}
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Settlement" aside={<SettlementChip state={detail.settlement.state} />} />
          <CardBody className="stack">
            <Grid columns={4}>
              <Stat label="Gross" value={fmt(detail.settlement.gross)} />
              <Stat label="Cash paid" value={fmt(detail.settlement.paidCash)} meta={detail.settlement.refunds.cents ? `Refunds ${fmt(detail.settlement.refunds)}` : undefined} />
              <Stat label="Credits applied" value={fmt(detail.settlement.appliedCredits)} meta={`Withholding ${fmt(detail.settlement.withholding)} · other ${fmt(detail.settlement.otherNonCash)}`} />
              <Stat label={detail.type === 'credit-note' ? 'Unapplied credit' : 'Unpaid balance'} value={fmt(detail.settlement.unpaidBalance)} meta={detail.settlement.retentionHeld.cents ? `Includes retention ${fmt(detail.settlement.retentionHeld)}` : undefined} />
            </Grid>
            <DataTable
              columns={[
                { header: 'Type', lead: true, render: (row: InvoiceDetail['settlements'][number]) => <CellMain>{SETTLEMENT_TYPE_LABELS[row.type]}</CellMain> },
                { header: 'Source', render: (row: InvoiceDetail['settlements'][number]) => row.source },
                { header: 'Effective', render: (row: InvoiceDetail['settlements'][number]) => formatDateLong(row.date) },
                { header: 'Amount', align: 'right', render: (row: InvoiceDetail['settlements'][number]) => <span className="num">{row.type === 'refund' ? '−' : ''}{fmt(row.amount)}</span> },
              ]}
              rows={detail.settlements}
              rowKey={(row) => row.id}
              empty="No settlements yet. Approval never implies payment."
            />
            {detail.retention.length > 0 ? (
              <DataTable
                columns={[
                  { header: 'Retention', lead: true, render: (row: InvoiceDetail['retention'][number]) => <CellMain>{row.condition}</CellMain> },
                  { header: 'Forecast release', render: (row: InvoiceDetail['retention'][number]) => formatDateLong(row.forecast) },
                  { header: 'Status', render: (row: InvoiceDetail['retention'][number]) => (row.released ? <Chip tone="good" icon="i-check">Released</Chip> : <Chip tone="neutral" icon="i-clock">Held</Chip>) },
                  { header: 'Amount', align: 'right', render: (row: InvoiceDetail['retention'][number]) => <span className="num">{fmt(row.amount)}</span> },
                ]}
                rows={detail.retention}
                rowKey={(row) => row.id}
              />
            ) : null}
            {permissions.canPay && detail.reviewState === 'approved' && detail.type === 'invoice' ? (
              <ActionForm action={addRetentionAction} submitLabel="Record retention" submitVariant="default" hiddenFields={{ invoiceId: detail.id }}>
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <TextField id={`ret-amt-${detail.id}`} name="amount" label="Retention amount (fixed, gross)" inputMode="decimal" invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                    <TextField id={`ret-cond-${detail.id}`} name="releaseCondition" label="Release condition" placeholder="Practical completion" invalid={Boolean(firstError(fieldErrors, 'releaseCondition'))} hint={firstError(fieldErrors, 'releaseCondition')} />
                    <TextField id={`ret-date-${detail.id}`} name="forecastReleaseDate" label="Forecast release date" type="date" />
                  </FieldGrid>
                )}
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Comments and audit timeline" />
          <CardBody className="stack">
            <Timeline entries={detail.timeline.map((item) => ({ id: item.id, state: item.state, title: item.title, meta: item.meta }))} />
            {permissions.canCapture ? (
              <ActionForm action={addInvoiceCommentAction} submitLabel="Add comment" submitVariant="default" hiddenFields={{ invoiceId: detail.id }}>
                {({ fieldErrors }) => <TextField id={`cmt-${detail.id}`} name="text" label="Comment" invalid={Boolean(firstError(fieldErrors, 'text'))} hint={firstError(fieldErrors, 'text')} />}
              </ActionForm>
            ) : null}
            <CellSub>Comments append; they never change a revision.</CellSub>
          </CardBody>
        </Card>
      </Stack>
    </div>
  );
}
