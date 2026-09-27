'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { asId } from '@/shared/types/common';
import { fromMajorUnits, money, scaleMoney, subtractMoney, type Money } from '@/shared/lib/money';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { entitiesRepository } from '@/modules/entities/repository';
import { propertiesRepository } from '@/modules/properties/repository';
import { loansRepository } from './repository';
import type { Loan, LoanDirection, LoanSecurity, RateType, Repayment, RepaymentType } from './model';

const DIRECTIONS: readonly LoanDirection[] = ['liability', 'receivable'];
const RATE_TYPES: readonly RateType[] = ['fixed', 'variable'];
const REPAYMENT_TYPES: readonly RepaymentType[] = ['P&I', 'IO', 'custom'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function revalidate(): void {
  revalidatePath('/loans');
  revalidatePath('/dashboard');
  revalidatePath('/properties');
}

/**
 * Opening repayment split for a facility with no statement yet.
 *
 * The model stores the lender's own split, which only a statement can supply.
 * Until one is recorded, one month's simple interest on the opening balance is
 * the working figure — capped at the repayment, so principal is never negative.
 */
function openingRepayment(type: RepaymentType, monthly: Money, balance: Money, annualRate: number): Repayment {
  const accrued = scaleMoney(balance, annualRate / 12);
  const interestComponent = type === 'IO' || accrued.cents > monthly.cents ? monthly : accrued;
  return {
    type,
    monthly,
    principalComponent: subtractMoney(monthly, interestComponent),
    interestComponent,
  };
}

/**
 * Add a facility (FR-03).
 *
 * Direction is part of the record, not a display concern: a receivable is money
 * owed to the portfolio and never reaches total debt or an LVR (FR-11).
 */
export async function createLoanAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Facility added', () => {
    const actor = accessService.getCurrentUser();
    const lender = requireString(form, 'lender', 'Lender');
    const facilityName = requireString(form, 'facilityName', 'Facility name');
    const direction = readChoice(form, 'direction', DIRECTIONS) ?? 'liability';
    const counterpartyLabel = requireString(form, 'counterpartyLabel', 'Borrower');

    const balance = readAmount(form, 'balance');
    if (balance === undefined || balance <= 0) {
      throw new ValidationError('Enter a balance greater than zero.', {
        fieldErrors: { balance: ['A facility balance must be greater than zero.'] },
      });
    }

    const balanceAsOf = requireString(form, 'balanceAsOf', 'Balance date');
    if (!ISO_DATE.test(balanceAsOf)) {
      throw new ValidationError('Enter the balance date as YYYY-MM-DD.', {
        fieldErrors: { balanceAsOf: ['Use the format YYYY-MM-DD.'] },
      });
    }

    // Entered as a percentage ("5.85"), stored as a fraction (0.0585).
    const ratePercent = readAmount(form, 'annualRate');
    if (ratePercent === undefined || ratePercent < 0 || ratePercent >= 100) {
      throw new ValidationError('Enter an annual rate between 0 and 100.', {
        fieldErrors: { annualRate: ['Enter the rate as a percentage, e.g. 5.85.'] },
      });
    }
    const annualRate = ratePercent / 100;

    const monthlyRepayment = readAmount(form, 'monthlyRepayment') ?? 0;
    if (monthlyRepayment < 0) {
      throw new ValidationError('A repayment cannot be negative.', {
        fieldErrors: { monthlyRepayment: ['Enter zero or more.'] },
      });
    }

    const securityPropertyRaw = readString(form, 'securityPropertyId');
    let security: LoanSecurity = { kind: 'unsecured', propertyIds: [], label: 'Unsecured' };
    if (securityPropertyRaw !== undefined) {
      const property = propertiesRepository.find(asId<'Property'>(securityPropertyRaw));
      if (!property) throw new ValidationError('That property no longer exists.');
      security = { kind: 'single', propertyIds: [property.id], label: property.name };
    }

    const borrowerEntityRaw = readString(form, 'borrowerEntityId');
    const borrower = borrowerEntityRaw ? entitiesRepository.findEntity(asId<'Entity'>(borrowerEntityRaw)) : undefined;
    if (borrowerEntityRaw && !borrower) throw new ValidationError('That entity no longer exists.');

    const balanceMoney = fromMajorUnits(balance);
    const repaymentType = readChoice(form, 'repaymentType', REPAYMENT_TYPES) ?? 'P&I';
    const monthly = monthlyRepayment === 0 ? money(0) : fromMajorUnits(monthlyRepayment);

    const loan: Loan = {
      id: asId<'Loan'>(`loan-${randomUUID()}`),
      lender,
      facilityName,
      direction,
      counterpartyLabel,
      borrowerEntityIds: borrower ? [borrower.id] : [],
      balance: balanceMoney,
      balanceAsOf,
      rate: { annual: annualRate, type: readChoice(form, 'rateType', RATE_TYPES) ?? 'variable' },
      repayment: openingRepayment(repaymentType, monthly, balanceMoney, annualRate),
      security,
    };

    const created = loansRepository.insert(loan);
    accessService.record({
      actor: actor.name,
      summary: `Facility added · ${lender} · ${facilityName}`,
      context: `${direction} · ${security.label} · balance as of ${balanceAsOf}`,
    });
    revalidate();
    return created;
  });
}
