/**
 * Invoices data access — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type {
  InvoiceId,
  InvoiceIntakeId,
  InvoiceRevisionId,
  PaymentId,
  PaymentImportId,
  ProjectId,
  ReconciliationItemId,
  RetentionTrancheId,
} from '@/shared/types/common';
import type {
  ApprovalDecision,
  Invoice,
  InvoiceIntake,
  InvoiceRevision,
  OutboxEvent,
  Payment,
  PaymentImport,
  ReconciliationItem,
  RetentionTranche,
  SettlementAllocation,
} from './model';
import {
  seedApprovalDecisions,
  seedInvoiceIntakes,
  seedInvoiceRevisions,
  seedInvoices,
  seedOutboxEvents,
  seedPaymentImports,
  seedPayments,
  seedReconciliationItems,
  seedRetentionTranches,
  seedSettlementAllocations,
} from './data/seed';

const intakes = createCollection<InvoiceIntake>('invoices.intakes', seedInvoiceIntakes);
const invoices = createCollection<Invoice>('invoices.invoices', seedInvoices);
const revisions = createCollection<InvoiceRevision>('invoices.revisions', seedInvoiceRevisions);
const decisions = createCollection<ApprovalDecision>('invoices.approval-decisions', seedApprovalDecisions);
const payments = createCollection<Payment>('invoices.payments', seedPayments);
const settlements = createCollection<SettlementAllocation>('invoices.settlements', seedSettlementAllocations);
const retention = createCollection<RetentionTranche>('invoices.retention', seedRetentionTranches);
const reconciliation = createCollection<ReconciliationItem>('invoices.reconciliation-items', seedReconciliationItems);
const imports = createCollection<PaymentImport>('invoices.payment-imports', seedPaymentImports);
const outbox = createCollection<OutboxEvent>('invoices.outbox', seedOutboxEvents);

export const invoicesRepository = {
  listIntakes: (projectId: ProjectId): readonly InvoiceIntake[] => intakes.where((row) => row.projectId === projectId),
  findIntake: (id: InvoiceIntakeId): InvoiceIntake | undefined => intakes.find(id),
  insertIntake: (row: InvoiceIntake): InvoiceIntake => intakes.insert(row),
  updateIntake: (id: InvoiceIntakeId, changes: Partial<Omit<InvoiceIntake, 'id'>>): InvoiceIntake | undefined => intakes.update(id, changes),

  listInvoices: (projectId: ProjectId): readonly Invoice[] => invoices.where((row) => row.projectId === projectId),
  findInvoice: (id: InvoiceId): Invoice | undefined => invoices.find(id),
  insertInvoice: (row: Invoice): Invoice => invoices.insert(row),
  updateInvoice: (id: InvoiceId, changes: Partial<Omit<Invoice, 'id'>>): Invoice | undefined => invoices.update(id, changes),

  listRevisions: (invoiceId: InvoiceId): readonly InvoiceRevision[] =>
    [...revisions.where((row) => row.invoiceId === invoiceId)].sort((a, b) => a.revisionNumber - b.revisionNumber),
  findRevision: (id: InvoiceRevisionId): InvoiceRevision | undefined => revisions.find(id),
  insertRevision: (row: InvoiceRevision): InvoiceRevision => revisions.insert(row),
  /** Only ever used to set `frozen` on approval; content is never rewritten. */
  freezeRevision: (id: InvoiceRevisionId): InvoiceRevision | undefined => revisions.update(id, { frozen: true }),

  listDecisions: (recordId: string): readonly ApprovalDecision[] => decisions.where((row) => row.recordId === recordId),
  listProjectDecisions: (projectId: ProjectId): readonly ApprovalDecision[] => decisions.where((row) => row.projectId === projectId),
  insertDecision: (row: ApprovalDecision): ApprovalDecision => decisions.insert(row),

  listPayments: (projectId: ProjectId): readonly Payment[] => payments.where((row) => row.projectId === projectId),
  findPayment: (id: PaymentId): Payment | undefined => payments.find(id),
  insertPayment: (row: Payment): Payment => payments.insert(row),

  listSettlements: (projectId: ProjectId): readonly SettlementAllocation[] => settlements.where((row) => row.projectId === projectId),
  settlementsForInvoice: (invoiceId: InvoiceId): readonly SettlementAllocation[] => settlements.where((row) => row.invoiceId === invoiceId),
  settlementsForPayment: (paymentId: PaymentId): readonly SettlementAllocation[] => settlements.where((row) => row.paymentId === paymentId),
  settlementsFromCreditNote: (creditNoteId: InvoiceId): readonly SettlementAllocation[] =>
    settlements.where((row) => row.creditNoteInvoiceId === creditNoteId),
  insertSettlement: (row: SettlementAllocation): SettlementAllocation => settlements.insert(row),

  listRetention: (projectId: ProjectId): readonly RetentionTranche[] => retention.where((row) => row.projectId === projectId),
  retentionForInvoice: (invoiceId: InvoiceId): readonly RetentionTranche[] => retention.where((row) => row.invoiceId === invoiceId),
  findRetention: (id: RetentionTrancheId): RetentionTranche | undefined => retention.find(id),
  insertRetention: (row: RetentionTranche): RetentionTranche => retention.insert(row),
  updateRetention: (id: RetentionTrancheId, changes: Partial<Omit<RetentionTranche, 'id'>>): RetentionTranche | undefined =>
    retention.update(id, changes),

  listReconciliationItems: (projectId: ProjectId): readonly ReconciliationItem[] => reconciliation.where((row) => row.projectId === projectId),
  findReconciliationItem: (id: ReconciliationItemId): ReconciliationItem | undefined => reconciliation.find(id),
  openItemForPayment: (paymentId: PaymentId): ReconciliationItem | undefined =>
    reconciliation.findBy((row) => row.paymentId === paymentId && row.state === 'open'),
  insertReconciliationItem: (row: ReconciliationItem): ReconciliationItem => reconciliation.insert(row),
  updateReconciliationItem: (id: ReconciliationItemId, changes: Partial<Omit<ReconciliationItem, 'id'>>): ReconciliationItem | undefined =>
    reconciliation.update(id, changes),

  listImports: (projectId: ProjectId): readonly PaymentImport[] => imports.where((row) => row.projectId === projectId),
  findImport: (id: PaymentImportId): PaymentImport | undefined => imports.find(id),
  insertImport: (row: PaymentImport): PaymentImport => imports.insert(row),
  updateImport: (id: PaymentImportId, changes: Partial<Omit<PaymentImport, 'id'>>): PaymentImport | undefined => imports.update(id, changes),

  listOutbox: (projectId: ProjectId): readonly OutboxEvent[] => outbox.where((row) => row.projectId === projectId),
  insertOutbox: (row: OutboxEvent): OutboxEvent => outbox.insert(row),

  /** Test isolation. */
  reset: (): void => {
    intakes.reset();
    invoices.reset();
    revisions.reset();
    decisions.reset();
    payments.reset();
    settlements.reset();
    retention.reset();
    reconciliation.reset();
    imports.reset();
    outbox.reset();
  },
};
