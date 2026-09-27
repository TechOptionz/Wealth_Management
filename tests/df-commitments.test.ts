/**
 * Development Finance — commitments and variations (CST03–CST05, IAM04),
 * plus the F03 end-to-end commitment conversion through the real services.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { accessService } from '@/modules/access/service';
import { USER_IDS } from '@/modules/access/data/seed';
import { projectsRepository } from '@/modules/projects/repository';
import { projectsService } from '@/modules/projects/service';
import { PROJECT_IDS } from '@/modules/projects/data/seed';
import { budgetsRepository } from '@/modules/budgets/repository';
import { commitmentsRepository } from '@/modules/commitments/repository';
import { commitmentsService } from '@/modules/commitments/service';
import { commitmentsApi } from '@/modules/commitments/api';
import { createCommitmentAction, decideVariationAction } from '@/modules/commitments/actions';
import { COMMITMENT_IDS, COST_LINE_IDS, SUPPLIER_IDS, VARIATION_IDS } from '@/modules/commitments/data/seed';
import { invoicesRepository } from '@/modules/invoices/repository';
import { invoicesService } from '@/modules/invoices/service';
import { costLinePosition, grossFromNet } from '@/shared/finance-engine';
import { fromMajorUnits } from '@/shared/lib/money';
import { asId, type CommitmentId, type CostLineId } from '@/shared/types/common';
import { ForbiddenError, ValidationError } from '@/shared/lib/errors';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';

const idle = IDLE_RESULT as ActionResult<unknown>;
const RIVERSIDE = PROJECT_IDS.riverside;
const $ = (dollars: number): number => Math.round(dollars * 100);

function formOf(fields: Record<string, string | string[]>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  }
  return form;
}

beforeEach(() => {
  projectsRepository.reset();
  budgetsRepository.reset();
  commitmentsRepository.reset();
  invoicesRepository.reset();
});
afterEach(() => accessService.switchUser(USER_IDS.jawad));

function newCommitment(net: number, line: CostLineId = COST_LINE_IDS.prof01, reference = 'C-900'): CommitmentId {
  const created = commitmentsService.createCommitment({
    projectId: RIVERSIDE,
    supplierId: SUPPLIER_IDS.harbourLegal,
    reference,
    title: 'Test engagement',
    originalAmount: fromMajorUnits(net),
    taxTreatment: 'standard-gst',
    startDate: '2026-09-01',
    stages: [],
    allocations: [{ costLineId: line, amount: fromMajorUnits(net) }],
    actor: USER_IDS.mahvish,
  });
  commitmentsService.authoriseCommitment(created.id, USER_IDS.jawad);
  return created.id;
}

describe('CST03 · commitments split across cost lines', () => {
  it('refuses an allocation that does not add up to the contract value', () => {
    expect(() =>
      commitmentsService.createCommitment({
        projectId: RIVERSIDE,
        supplierId: SUPPLIER_IDS.meridian,
        reference: 'C-777',
        title: 'Unbalanced',
        originalAmount: fromMajorUnits(10_000),
        taxTreatment: 'standard-gst',
        startDate: '2026-09-01',
        stages: [],
        allocations: [
          { costLineId: COST_LINE_IDS.prof01, amount: fromMajorUnits(6_000) },
          { costLineId: COST_LINE_IDS.con02, amount: fromMajorUnits(3_999.99) },
        ],
        actor: USER_IDS.jawad,
      }),
    ).toThrow(ValidationError);
  });

  it('accepts a balanced split with balanced stages, bumps the model revision and starts as a draft', () => {
    const before = projectsService.require(RIVERSIDE).modelRevision;
    const created = commitmentsService.createCommitment({
      projectId: RIVERSIDE,
      supplierId: SUPPLIER_IDS.meridian,
      reference: 'C-778',
      title: 'Split engagement',
      originalAmount: fromMajorUnits(10_000),
      taxTreatment: 'standard-gst',
      startDate: '2026-09-01',
      stages: [
        { id: 's1', name: 'One', amount: fromMajorUnits(4_000) },
        { id: 's2', name: 'Two', amount: fromMajorUnits(6_000) },
      ],
      allocations: [
        { costLineId: COST_LINE_IDS.prof01, stageId: 's1', amount: fromMajorUnits(4_000) },
        { costLineId: COST_LINE_IDS.con02, stageId: 's2', amount: fromMajorUnits(6_000) },
      ],
      actor: USER_IDS.jawad,
    });
    expect(created.state).toBe('draft');
    expect(projectsService.require(RIVERSIDE).modelRevision).toBe(before + 1);
    // A draft is not an obligation.
    expect(commitmentsService.allocationsByLine(RIVERSIDE).get(COST_LINE_IDS.con02)).toBeUndefined();
    commitmentsService.authoriseCommitment(created.id, USER_IDS.jawad);
    expect(commitmentsService.allocationsByLine(RIVERSIDE).get(COST_LINE_IDS.con02)?.[0]?.amount.cents).toBe($(6_000));
  });

  it('refuses a summary row and a cost line of another project', () => {
    expect(() => newCommitment(1_000, asId<'CostLine'>('cl-riverside-acq-00'), 'C-901')).toThrow(/summary row/);
    expect(() => newCommitment(1_000, asId<'CostLine'>('cl-nowhere'), 'C-902')).toThrow();
  });

  it('the create action reports the unbalanced split as a field error', async () => {
    const result = await createCommitmentAction(
      idle,
      formOf({
        projectId: RIVERSIDE,
        supplierId: SUPPLIER_IDS.meridian,
        reference: 'C-779',
        title: 'From the form',
        originalAmount: '$5,000.00',
        startDate: '2026-09-01',
        allocCostLineId: [COST_LINE_IDS.prof01, COST_LINE_IDS.con02],
        allocAmount: ['2,000', '2,000'],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.allocations).toBeDefined();
  });
});

describe('CST04 · variations', () => {
  it('only approved variations change the revised value; pending shows separately', () => {
    expect(commitmentsService.revisedValue(COMMITMENT_IDS.c002).cents).toBe($(3_120_000));
    expect(commitmentsService.pendingVariationsTotal(COMMITMENT_IDS.c002).cents).toBe($(36_000));

    const submitted = commitmentsService.submitVariation({
      commitmentId: COMMITMENT_IDS.c002,
      reference: 'V-003',
      description: 'Driveway re-grade',
      amount: fromMajorUnits(-5_000),
      actor: USER_IDS.mahvish,
    });
    expect(commitmentsService.revisedValue(COMMITMENT_IDS.c002).cents).toBe($(3_120_000));
    expect(commitmentsService.pendingVariationsTotal(COMMITMENT_IDS.c002).cents).toBe($(31_000));

    commitmentsService.approveVariation(submitted.id, USER_IDS.jawad);
    expect(commitmentsService.revisedValue(COMMITMENT_IDS.c002).cents).toBe($(3_115_000));
    commitmentsService.rejectVariation(VARIATION_IDS.v002, USER_IDS.jawad, 'Not in scope');
    expect(commitmentsService.pendingVariationsTotal(COMMITMENT_IDS.c002).cents).toBe(0);
    expect(commitmentsService.revisedValue(COMMITMENT_IDS.c002).cents).toBe($(3_115_000));
  });

  it('the submitter cannot approve their own variation (IAM04), through the service and the action', async () => {
    expect(() => commitmentsService.approveVariation(VARIATION_IDS.v002, USER_IDS.mahvish)).toThrow(ForbiddenError);
    accessService.switchUser(USER_IDS.mahvish);
    const refused = await decideVariationAction(idle, formOf({ variationId: VARIATION_IDS.v002, decision: 'approved' }));
    expect(refused.ok).toBe(false);
    accessService.switchUser(USER_IDS.jawad);
    const approved = await decideVariationAction(idle, formOf({ variationId: VARIATION_IDS.v002, decision: 'approved' }));
    expect(approved.ok).toBe(true);
    expect(commitmentsService.revisedValue(COMMITMENT_IDS.c002).cents).toBe($(3_156_000));
  });

  it('rejecting needs a reason; the investor cannot read commitments', () => {
    expect(() => commitmentsService.rejectVariation(VARIATION_IDS.v002, USER_IDS.jawad, ' ')).toThrow(ValidationError);
    accessService.switchUser(USER_IDS.hassan);
    expect(() => commitmentsApi.list(RIVERSIDE)).toThrow(ForbiddenError);
  });

  it('allocationsByLine apportions the revised value and sums to it exactly', () => {
    const shares = commitmentsService.allocationsByLine(RIVERSIDE);
    const c002 = (shares.get(COST_LINE_IDS.con01) ?? []).filter((row) => row.commitmentId === COMMITMENT_IDS.c002);
    expect(c002).toHaveLength(1);
    expect(c002[0]?.amount.cents).toBe($(3_120_000));
    expect(c002[0]?.supplierName).toBe('Brisbane Civil & Build Pty Ltd');
    const c001 = (shares.get(COST_LINE_IDS.prof01) ?? []).find((row) => row.commitmentId === COMMITMENT_IDS.c001);
    expect(c001?.amount.cents).toBe($(186_000));
  });
});

describe('CST05 · contract position on one gross basis', () => {
  it('C-002 from the seed', () => {
    const position = invoicesService.contractPosition(COMMITMENT_IDS.c002);
    expect(position.contractTotal.cents).toBe($(3_432_000));
    expect(position.invoicedToDate.cents).toBe($(242_000));
    expect(position.paidToDate.cents).toBe(0);
    expect(position.approvedUnpaid.cents).toBe($(242_000));
    expect(position.uninvoicedBalance.cents).toBe($(3_190_000));
    expect(position.remainingEstimate.cents).toBe($(3_432_000));
  });

  it('C-001 nets the credit note and counts part payment', () => {
    const position = invoicesService.contractPosition(COMMITMENT_IDS.c001);
    expect(position.contractTotal.cents).toBe($(204_600));
    expect(position.invoicedToDate.cents).toBe($(66_000 + 52_800 - 4_400));
    expect(position.paidToDate.cents).toBe($(96_000));
    expect(position.approvedUnpaid.cents).toBe($(18_400));
  });
});

describe('F03 · commitment conversion end to end (AT04)', () => {
  /** Build costLinePosition inputs for one line, gross basis, from the services. */
  function positionFor(line: CostLineId, baselineCents: number) {
    const commitments = (commitmentsService.allocationsByLine(RIVERSIDE).get(line) ?? []).map((share) => {
      const commitment = commitmentsService.requireCommitment(share.commitmentId);
      const approved = (invoicesService.approvedAllocationsByLine(RIVERSIDE).get(line) ?? [])
        .filter((view) => view.commitmentId === share.commitmentId)
        .reduce((sum, view) => sum + view.sign * view.gross.cents, 0);
      return { id: share.commitmentId, revisedValueCents: grossFromNet(share.amount.cents, commitment.taxTreatment), approvedInvoicedCents: approved };
    });
    const direct = (invoicesService.approvedAllocationsByLine(RIVERSIDE).get(line) ?? [])
      .filter((view) => view.commitmentId === null)
      .reduce((sum, view) => sum + view.sign * view.gross.cents, 0);
    const settled = invoicesService.settledCashByLine(RIVERSIDE).get(line) ?? [];
    const committed = commitments.reduce((sum, row) => sum + row.revisedValueCents, 0);
    return costLinePosition({
      baselineCents,
      commitments,
      directSpendApprovedCents: direct,
      settledCashCents: settled.reduce((sum, row) => sum + row.cash.cents, 0),
      nonCashSettledCents: settled.reduce((sum, row) => sum + row.nonCash.cents, 0),
      uncommittedAllowanceCents: baselineCents - committed,
    });
  }

  function approveInvoice(net: number, number: string, commitmentId: CommitmentId) {
    const invoice = invoicesService.createInvoice({
      projectId: RIVERSIDE,
      type: 'invoice',
      supplierId: SUPPLIER_IDS.harbourLegal,
      number,
      invoiceDate: '2026-09-04',
      dueDate: '2026-09-30',
      net: fromMajorUnits(net),
      tax: fromMajorUnits(net / 10),
      lineDescriptions: ['Engineering'],
      allocations: [{ costLineId: asId<'CostLine'>('cl-riverside-prof-02'), commitmentId, net: fromMajorUnits(net), tax: fromMajorUnits(net / 10), taxTreatment: 'standard-gst' }],
      actor: USER_IDS.accountant,
    });
    invoicesService.submitForApproval(invoice.id, USER_IDS.accountant);
    invoicesService.decide({ invoiceId: invoice.id, revisionId: invoice.currentRevisionId, actor: USER_IDS.jawad, decision: 'approved' });
    return invoice.id;
  }

  it('C 88000; approve 33000; pay 11000 → A 22000, R 55000, EAC 110000; then F03a/F03b', () => {
    const line = asId<'CostLine'>('cl-riverside-prof-02');
    const commitmentId = newCommitment(80_000, line, 'C-F03'); // 88,000 gross
    const first = approveInvoice(30_000, 'ENG-1', commitmentId); // 33,000 gross
    invoicesService.recordPayment({
      projectId: RIVERSIDE,
      amount: fromMajorUnits(11_000),
      direction: 'outflow',
      effectiveDate: '2026-09-05',
      reference: 'ENG-1 part',
      actor: USER_IDS.accountant,
      allocations: [{ invoiceId: first, amount: fromMajorUnits(11_000), settlementType: 'cash' }],
    });
    const base = positionFor(line, $(110_000));
    expect(base.approvedCostCents).toBe($(33_000));
    expect(base.approvedUnpaidCents).toBe($(22_000));
    expect(base.unbilledCommitmentCents).toBe($(55_000));
    expect(base.expectedFinalCostCents).toBe($(110_000));
    expect(base.remainingCashCents).toBe($(99_000));
    expect(base.varianceCents).toBe(0);

    // F03a — another 11,000 approved against the commitment.
    const second = approveInvoice(10_000, 'ENG-2', commitmentId);
    const afterApproval = positionFor(line, $(110_000));
    expect(afterApproval.approvedCostCents).toBe($(44_000));
    expect(afterApproval.approvedUnpaidCents).toBe($(33_000));
    expect(afterApproval.unbilledCommitmentCents).toBe($(44_000));
    expect(afterApproval.expectedFinalCostCents).toBe($(110_000));

    // F03b — then a payment of 11,000.
    invoicesService.recordPayment({
      projectId: RIVERSIDE,
      amount: fromMajorUnits(11_000),
      direction: 'outflow',
      effectiveDate: '2026-09-06',
      reference: 'ENG-2',
      actor: USER_IDS.accountant,
      allocations: [{ invoiceId: second, amount: fromMajorUnits(11_000), settlementType: 'cash' }],
    });
    const afterPayment = positionFor(line, $(110_000));
    expect(afterPayment.settledCashCents).toBe($(22_000));
    expect(afterPayment.approvedUnpaidCents).toBe($(22_000));
    expect(afterPayment.expectedFinalCostCents).toBe($(110_000));
    expect(afterPayment.remainingCashCents).toBe($(88_000));
  });
});
