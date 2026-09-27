/**
 * FR-05 — leases and payment schedules.
 *
 * Acceptance: "A fortnightly lease generates the agreed due dates; an early
 * termination removes only unearned future charges and leaves receipts intact."
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Actions call revalidatePath, which needs a request scope a unit test lacks.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { recordRentPaymentAction } from '@/modules/leases/actions';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';
import { CURRENT_USER_ID } from '@/modules/access/data/seed';
import { leasesService } from '@/modules/leases/service';
import { leasesRepository } from '@/modules/leases/repository';
import { LEASE_IDS, TENANT_IDS } from '@/modules/leases/data/seed';
import { COMPONENT_IDS, PROPERTY_IDS } from '@/modules/properties/data/seed';
import { asId } from '@/shared/types/common';
import { fromMajorUnits, money } from '@/shared/lib/money';
import { NotFoundError, ValidationError } from '@/shared/lib/errors';

const AS_OF = '2026-09-06';

beforeEach(() => {
  leasesRepository.reset();
});

describe('FR-05 · charge generation', () => {
  it('generates fortnightly charges on the agreed schedule', () => {
    const created = leasesService.generateCharges(LEASE_IDS.nguyenR3);
    const dates = created.map((charge) => charge.dueOn);

    // Anchored 2 Jun 2026, fortnightly, to 31 May 2027.
    expect(dates[0]).toBe('2026-06-02');
    expect(dates[1]).toBe('2026-06-16');
    expect(dates[2]).toBe('2026-06-30');

    // Every gap is exactly 14 days.
    for (let i = 1; i < dates.length; i += 1) {
      const gap =
        (Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / 86_400_000;
      expect(gap).toBe(14);
    }
    // None fall past the lease end.
    expect(dates[dates.length - 1]! <= '2027-05-31').toBe(true);
  });

  it('charges every generated period at the lease rent', () => {
    const created = leasesService.generateCharges(LEASE_IDS.chenR2);
    expect(created.every((charge) => charge.amount.cents === fromMajorUnits(330).cents)).toBe(true);
  });
});

describe('FR-05 · early termination', () => {
  it('removes only unearned future charges and leaves receipts intact', () => {
    leasesService.generateCharges(LEASE_IDS.chenR2);
    const before = leasesRepository.listCharges(LEASE_IDS.chenR2).length;

    const result = leasesService.terminate({
      leaseId: LEASE_IDS.chenR2,
      endsOn: '2026-10-31',
      reason: 'Tenant relocating for work',
    });

    const remaining = leasesRepository.listCharges(LEASE_IDS.chenR2);
    expect(result.removedCharges).toBeGreaterThan(0);
    expect(remaining.length).toBe(before - result.removedCharges);
    // Nothing earned was touched.
    expect(remaining.every((charge) => charge.dueOn <= '2026-10-31')).toBe(true);
    expect(result.lease.endsOn).toBe('2026-10-31');
  });

  it('keeps a future charge that already has a receipt against it', () => {
    // Williams paid ahead: the 2 Sep charge carries an allocation.
    const paidCharge = asId<'RentCharge'>('chg-williams-0902');
    expect(leasesRepository.listAllocations(paidCharge).length).toBeGreaterThan(0);

    leasesService.terminate({
      leaseId: LEASE_IDS.williamsR4,
      endsOn: '2026-09-01',
      reason: 'Ended by agreement',
    });

    // The charge is dated after the termination date but was paid, so it stays.
    const kept = leasesRepository.listCharges(LEASE_IDS.williamsR4).map((charge) => charge.id);
    expect(kept).toContain(paidCharge);
    expect(leasesRepository.listAllocations(paidCharge).length).toBeGreaterThan(0);
  });

  it('leaves arrears unchanged when a tenant in arrears is terminated', () => {
    const before = leasesService.arrearsFor(LEASE_IDS.patelBenton, AS_OF).outstanding.cents;

    leasesService.terminate({
      leaseId: LEASE_IDS.patelBenton,
      endsOn: '2026-09-06',
      reason: 'Lease not renewed',
    });

    // Money already owed is not forgiven by ending the lease.
    expect(leasesService.arrearsFor(LEASE_IDS.patelBenton, AS_OF).outstanding.cents).toBe(before);
  });

  it('rejects a termination without a reason, or outside the lease term', () => {
    expect(() =>
      leasesService.terminate({ leaseId: LEASE_IDS.chenR2, endsOn: '2026-10-31', reason: '  ' }),
    ).toThrow(ValidationError);
    expect(() =>
      leasesService.terminate({ leaseId: LEASE_IDS.chenR2, endsOn: '2028-01-01', reason: 'Too late' }),
    ).toThrow(ValidationError);
  });
});

describe('FR-05 · effective rent changes', () => {
  it('reprices only future unpaid charges', () => {
    leasesService.generateCharges(LEASE_IDS.chenR2);
    const newRent = fromMajorUnits(360);

    const result = leasesService.changeRent({
      leaseId: LEASE_IDS.chenR2,
      newRent,
      effectiveFrom: '2026-11-01',
    });

    const charges = leasesRepository.listCharges(LEASE_IDS.chenR2);
    for (const charge of charges) {
      const expected = charge.dueOn >= '2026-11-01' ? newRent.cents : fromMajorUnits(330).cents;
      expect(charge.amount.cents, `charge ${charge.dueOn}`).toBe(expected);
    }
    expect(result.repricedCharges).toBeGreaterThan(0);
    expect(result.lease.rent.cents).toBe(newRent.cents);
  });

  it('never restates a charge that has already been paid', () => {
    const paidCharge = asId<'RentCharge'>('chg-williams-0902');
    const originalAmount = leasesRepository
      .listCharges(LEASE_IDS.williamsR4)
      .find((charge) => charge.id === paidCharge)?.amount.cents;

    leasesService.changeRent({
      leaseId: LEASE_IDS.williamsR4,
      newRent: fromMajorUnits(400),
      effectiveFrom: '2026-08-01',
    });

    const after = leasesRepository
      .listCharges(LEASE_IDS.williamsR4)
      .find((charge) => charge.id === paidCharge)?.amount.cents;
    expect(after).toBe(originalAmount);
  });

  it('rejects a zero rent or a change before the lease started', () => {
    expect(() =>
      leasesService.changeRent({ leaseId: LEASE_IDS.chenR2, newRent: fromMajorUnits(0), effectiveFrom: '2026-11-01' }),
    ).toThrow(ValidationError);
    expect(() =>
      leasesService.changeRent({ leaseId: LEASE_IDS.chenR2, newRent: fromMajorUnits(360), effectiveFrom: '2020-01-01' }),
    ).toThrow(ValidationError);
  });
});

describe('FR-05 · recording a rent payment', () => {
  const idle = IDLE_RESULT as ActionResult<unknown>;
  const formOf = (fields: Record<string, string>): FormData => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return form;
  };

  it('allocates the payment to the oldest unpaid charge and reduces arrears', async () => {
    // Patel owes $690 on the 28 Aug charge; add a later unpaid charge behind it.
    const oldest = asId<'RentCharge'>('chg-patel-0828');
    const later = leasesRepository.insertCharge({
      id: asId<'RentCharge'>('chg-patel-0904'),
      leaseId: LEASE_IDS.patelBenton,
      dueOn: '2026-09-04',
      amount: fromMajorUnits(1_380),
    });
    const before = leasesService.arrearsFor(LEASE_IDS.patelBenton, AS_OF).outstanding.cents;
    expect(before).toBe(fromMajorUnits(690 + 1_380).cents);

    const result = await recordRentPaymentAction(
      idle,
      formOf({ leaseId: LEASE_IDS.patelBenton, amount: '$500.00', receivedOn: AS_OF, note: 'Bank transfer' }),
    );

    expect(result.ok).toBe(true);
    // All of it went to the oldest charge; the later one is untouched.
    const onOldest = leasesRepository.listAllocations(oldest);
    expect(onOldest[onOldest.length - 1]?.amount.cents).toBe(fromMajorUnits(500).cents);
    expect(leasesRepository.listAllocations(later.id)).toHaveLength(0);
    expect(leasesService.arrearsFor(LEASE_IDS.patelBenton, AS_OF).outstanding.cents).toBe(
      before - fromMajorUnits(500).cents,
    );
  });

  it('spills across charges oldest first and reports what was settled', () => {
    const later = leasesRepository.insertCharge({
      id: asId<'RentCharge'>('chg-patel-0904'),
      leaseId: LEASE_IDS.patelBenton,
      dueOn: '2026-09-04',
      amount: fromMajorUnits(1_380),
    });

    const result = leasesService.allocatePaymentToLease({
      leaseId: LEASE_IDS.patelBenton,
      amount: fromMajorUnits(1_000),
      receivedOn: AS_OF,
      actor: CURRENT_USER_ID,
    });

    expect(result.chargesSettled).toBe(1);
    expect(leasesRepository.listAllocations(later.id)[0]?.amount.cents).toBe(fromMajorUnits(310).cents);
    expect(result.remainingBalance.cents).toBe(fromMajorUnits(1_070).cents);
  });

  it('rejects a zero amount with a field error rather than throwing', async () => {
    const result = await recordRentPaymentAction(
      idle,
      formOf({ leaseId: LEASE_IDS.patelBenton, amount: '0', receivedOn: AS_OF }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('FR-05 · tenant statement (running ledger)', () => {
  const LEDGER_LEASE = asId<'Lease'>('lease-test-ledger');

  /**
   * A hand-derived ledger whose cents do not round away. Expected lines as at 6 Sep:
   *
   *    1 Jul  Weekly rent               +412.50 →   412.50
   *    1 Jul  Payment (same day)        −412.50 →     0.00
   *    8 Jul  Weekly rent               +412.50 →   412.50
   *    9 Jul  Payment · Cash            −200.00 →   212.50
   *   10 Jul  Water recovery             +63.35 →   275.85
   *   12 Jul  Reversal · Dishonoured    +200.00 →   475.85
   *   15 Jul  Weekly rent               +412.50 →   888.35
   *   16 Jul  Approved credit            −12.50 →   875.85
   *   20 Jul  Payment (overpaid)      −1,000.01 →  −124.16   (tenant in credit)
   *
   * A charge due 10 Sep and a receipt on 7 Sep fall after the statement date.
   */
  function seedLedgerFixture(): void {
    leasesRepository.insert({
      id: LEDGER_LEASE,
      tenantId: TENANT_IDS.chen,
      propertyId: PROPERTY_IDS.comptonRd,
      componentId: COMPONENT_IDS.comptonRoom2,
      reference: 'TEST-LEDGER',
      startsOn: '2026-07-01',
      endsOn: '2027-06-30',
      rent: money(41_250),
      frequency: 'weekly',
      chargeAnchorOn: '2026-07-01',
      remindersEnabled: true,
      disputed: false,
    });

    const c1 = asId<'RentCharge'>('chg-ledger-0701');
    const c2 = asId<'RentCharge'>('chg-ledger-0708');
    const c3 = asId<'RentCharge'>('chg-ledger-0715');
    const c4 = asId<'RentCharge'>('chg-ledger-0910');
    leasesRepository.insertCharge({ id: c1, leaseId: LEDGER_LEASE, dueOn: '2026-07-01', amount: money(41_250) });
    leasesRepository.insertCharge({ id: c2, leaseId: LEDGER_LEASE, dueOn: '2026-07-08', amount: money(41_250) });
    leasesRepository.insertCharge({ id: c3, leaseId: LEDGER_LEASE, dueOn: '2026-07-15', amount: money(41_250) });
    // Inserted out of date order on purpose — the ledger must sort, not trust insertion.
    leasesRepository.insertCharge({
      id: asId<'RentCharge'>('chg-ledger-water'),
      leaseId: LEDGER_LEASE,
      dueOn: '2026-07-10',
      amount: money(6_335),
      kind: 'utility',
      description: 'Water recovery · Urban Utilities',
      sourceBillId: 'bill-test',
    });
    leasesRepository.insertCharge({ id: c4, leaseId: LEDGER_LEASE, dueOn: '2026-09-10', amount: money(41_250) });

    leasesService.recordReceipt({ chargeId: c1, amount: money(41_250), receivedOn: '2026-07-01' });
    const cash = leasesService.recordReceipt({
      chargeId: c2,
      amount: money(20_000),
      receivedOn: '2026-07-09',
      note: 'Cash',
    });
    leasesService.recordReversal({ allocationId: cash!.id, reversedOn: '2026-07-12', note: 'Dishonoured' });
    leasesService.recordCredit({
      chargeId: c3,
      amount: money(1_250),
      appliedOn: '2026-07-16',
      approvedBy: CURRENT_USER_ID,
      note: 'Goodwill for repair delay',
    });
    leasesService.recordReceipt({ chargeId: c3, amount: money(100_001), receivedOn: '2026-07-20' });
    leasesService.recordReceipt({ chargeId: c4, amount: money(5_000), receivedOn: '2026-09-07' });
  }

  const shape = (ledger: ReturnType<typeof leasesService.leaseLedger>) =>
    ledger.entries.map((entry) => [entry.date, entry.type, entry.side, entry.amount.cents, entry.balance.cents]);

  it('builds chronological entries with a running balance exact to the cent', () => {
    seedLedgerFixture();
    const ledger = leasesService.leaseLedger(LEDGER_LEASE, AS_OF);

    expect(shape(ledger)).toEqual([
      ['2026-07-01', 'charge', 'debit', 41_250, 41_250],
      ['2026-07-01', 'receipt', 'credit', 41_250, 0],
      ['2026-07-08', 'charge', 'debit', 41_250, 41_250],
      ['2026-07-09', 'receipt', 'credit', 20_000, 21_250],
      ['2026-07-10', 'charge', 'debit', 6_335, 27_585],
      ['2026-07-12', 'reversal', 'debit', 20_000, 47_585],
      ['2026-07-15', 'charge', 'debit', 41_250, 88_835],
      ['2026-07-16', 'credit', 'credit', 1_250, 87_585],
      ['2026-07-20', 'receipt', 'credit', 100_001, -12_416],
    ]);

    expect(ledger.totalCharged.cents).toBe(130_085);
    expect(ledger.totalReceived.cents).toBe(142_501);
    expect(ledger.currentBalance.cents).toBe(-12_416);

    // The statement reconciles three ways: last line, invoiced − paid, and the arrears figure.
    expect(ledger.entries[ledger.entries.length - 1]?.balance.cents).toBe(ledger.currentBalance.cents);
    expect(ledger.totalCharged.cents - ledger.totalReceived.cents).toBe(ledger.currentBalance.cents);
    expect(leasesService.arrearsFor(LEDGER_LEASE, AS_OF).outstanding.cents).toBe(ledger.currentBalance.cents);

    // Amounts are unsigned; the side carries the direction.
    expect(ledger.entries.every((entry) => entry.amount.cents > 0)).toBe(true);
  });

  it('describes each line from what was recorded', () => {
    seedLedgerFixture();
    const descriptions = leasesService.leaseLedger(LEDGER_LEASE, AS_OF).entries.map((entry) => entry.description);

    expect(descriptions[0]).toBe('Weekly rent');
    expect(descriptions[1]).toBe('Payment received');
    expect(descriptions[3]).toBe('Payment received · Cash');
    expect(descriptions[4]).toBe('Water recovery · Urban Utilities');
    expect(descriptions[5]).toBe('Payment reversed · Dishonoured');
    expect(descriptions[7]).toBe('Approved credit · Goodwill for repair delay');
  });

  it('stops at the statement date — later charges and receipts are not on it', () => {
    seedLedgerFixture();

    const midJuly = leasesService.leaseLedger(LEDGER_LEASE, '2026-07-09');
    expect(midJuly.entries.map((entry) => entry.date)).toEqual([
      '2026-07-01',
      '2026-07-01',
      '2026-07-08',
      '2026-07-09',
    ]);
    expect(midJuly.totalCharged.cents).toBe(82_500);
    expect(midJuly.totalReceived.cents).toBe(61_250);
    expect(midJuly.currentBalance.cents).toBe(21_250);

    const beforeStart = leasesService.leaseLedger(LEDGER_LEASE, '2026-06-30');
    expect(beforeStart.entries).toEqual([]);
    expect(beforeStart.totalCharged.cents).toBe(0);
    expect(beforeStart.totalReceived.cents).toBe(0);
    expect(beforeStart.currentBalance.cents).toBe(0);
  });

  it('carries the header a printed statement needs', () => {
    const ledger = leasesService.leaseLedger(LEASE_IDS.nguyenR3, AS_OF);

    expect(ledger.leaseId).toBe(LEASE_IDS.nguyenR3);
    expect(ledger.tenantName).toBe('A. Nguyen');
    expect(ledger.reference).toBe('166C-R3');
    expect(ledger.propertyLabel).toContain('Room 3');
    expect(ledger.leasePeriod).toEqual({ startsOn: '2026-06-01', endsOn: '2027-05-31' });
    expect(ledger.asOf).toBe(AS_OF);
  });

  it('reproduces the seeded arrears: Nguyen owes $200 after a part-payment', () => {
    const ledger = leasesService.leaseLedger(LEASE_IDS.nguyenR3, AS_OF);

    expect(shape(ledger)).toEqual([
      ['2026-08-25', 'charge', 'debit', 50_000, 50_000],
      ['2026-08-28', 'receipt', 'credit', 30_000, 20_000],
    ]);
    expect(ledger.entries[1]?.description).toBe('Payment received · bank import');
    expect(ledger.totalCharged.cents).toBe(50_000);
    expect(ledger.totalReceived.cents).toBe(30_000);
    expect(ledger.currentBalance.cents).toBe(20_000);
    expect(ledger.currentBalance.cents).toBe(leasesService.arrearsFor(LEASE_IDS.nguyenR3, AS_OF).outstanding.cents);
  });

  it('shows money received before its charge fell due as credit — Williams is $340 ahead', () => {
    const ledger = leasesService.leaseLedger(LEASE_IDS.williamsR4, AS_OF);

    expect(shape(ledger)).toEqual([
      ['2026-09-01', 'receipt', 'credit', 68_000, -68_000],
      ['2026-09-02', 'charge', 'debit', 34_000, -34_000],
    ]);
    expect(ledger.currentBalance.cents).toBe(-34_000);
    expect(ledger.currentBalance.cents).toBe(leasesService.arrearsFor(LEASE_IDS.williamsR4, AS_OF).outstanding.cents);
  });

  it('rejects an unknown lease', () => {
    expect(() => leasesService.leaseLedger(asId<'Lease'>('lease-nope'), AS_OF)).toThrow(NotFoundError);
  });
});
