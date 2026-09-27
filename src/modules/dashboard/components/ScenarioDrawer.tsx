'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Chip } from '@/shared/components/Chip';
import { FilterGroup } from '@/shared/components/FilterGroup';
import { Icon } from '@/shared/components/Icon';
import { Delta, Kpi } from '@/shared/components/Kpi';
import { Sub } from '@/shared/components/Layout';
import { formatMoney, formatPercent, type Money } from '@/shared/lib/money';
import type { PropertyId } from '@/shared/types/common';
import type { ScenarioInputs, ScenarioResult } from '../model';
import { RATE_SHOCK_OPTIONS, applyScenario } from '../scenario-math';

/** Pill value for "no rate change". The pill group is keyed by string, hence the text form. */
const NO_SHOCK = '0';

const SHOCK_OPTIONS = [
  { value: NO_SHOCK, label: 'No change' },
  ...RATE_SHOCK_OPTIONS.map((percent) => ({ value: String(percent), label: `+${percent.toFixed(2)}%` })),
];

function absolute(value: Money): Money {
  return { ...value, cents: Math.abs(value.cents) };
}

function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

/** Status is never colour alone: the outcome chip carries an icon and words. */
function outcomeChip(result: ScenarioResult) {
  if (result.simulatedCashFlow.cents < 0) {
    return (
      <Chip tone="bad" icon="i-alert">
        Cash flow negative
      </Chip>
    );
  }
  if (result.monthlyDelta.cents < 0) {
    return (
      <Chip tone="warn" icon="i-down">
        Reduced, still positive
      </Chip>
    );
  }
  if (result.monthlyDelta.cents > 0) {
    return (
      <Chip tone="good" icon="i-up">
        Improved
      </Chip>
    );
  }
  return (
    <Chip tone="neutral" icon="i-check">
      No change
    </Chip>
  );
}

export interface ScenarioDrawerProps {
  readonly inputs: ScenarioInputs;
}

/**
 * The "Simulate scenario" button and the slide-over it opens (FR-11).
 *
 * The inputs arrive from the server already permission-checked. Every control
 * change re-runs `applyScenario` in the browser, so the tiles answer at once and
 * nothing is written anywhere; closing the drawer discards the scenario.
 */
export function ScenarioDrawer({ inputs }: ScenarioDrawerProps) {
  const id = useId();
  const panelId = `${id}-panel`;
  const titleId = `${id}-title`;
  const [isOpen, setIsOpen] = useState(false);
  const [shock, setShock] = useState(NO_SHOCK);
  const [vacant, setVacant] = useState<readonly PropertyId[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const result = useMemo(
    () => applyScenario(inputs, { rateDeltaPercent: Number(shock), vacantPropertyIds: vacant }),
    [inputs, shock, vacant],
  );

  const close = useCallback((): void => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, close]);

  const toggleVacant = (propertyId: PropertyId, checked: boolean): void => {
    setVacant((current) => {
      const without = current.filter((entry) => entry !== propertyId);
      return checked ? [...without, propertyId] : without;
    });
  };

  const hasShock = result.rateDeltaPercent !== 0;
  const facilityCount = inputs.variableFacilities.length;
  const deltaDirection = result.monthlyDelta.cents < 0 ? 'down' : result.monthlyDelta.cents > 0 ? 'up' : 'flat';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn sm"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => setIsOpen(true)}
      >
        <Icon name="i-calc" size={14} />
        Simulate scenario
      </button>

      {isOpen ? (
        <>
          <div className="scrim show" onClick={close} aria-hidden="true" style={{ zIndex: 40 }} />
          <div
            id={panelId}
            className="card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            // Positioning only — the surface, shadow and typography come from `.card`.
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(480px, 100vw)',
              zIndex: 41,
              overflowY: 'auto',
              borderRadius: 0,
            }}
          >
            <div className="card-h" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
              <h3 id={titleId}>What-if scenario</h3>
              <button
                ref={closeRef}
                type="button"
                className="icon-btn"
                aria-label="Close scenario simulator"
                onClick={close}
              >
                <Icon name="i-x" />
              </button>
            </div>

            <div className="card-b stack">
              <Sub style={{ display: 'block' }}>
                {inputs.baselineMonthLabel
                  ? `Baseline is ${inputs.baselineMonthLabel} posted cash flow: receipts ${formatMoney(inputs.baselineReceipts)} less outgoings ${formatMoney(inputs.baselineOutgoings)}, ${formatMoney(inputs.baselineCashFlow)} a month on a cash basis (BR-03).`
                  : 'No month has been posted yet, so the baseline is zero.'}{' '}
                Nothing you set here is saved.
              </Sub>

              <section aria-labelledby={`${id}-rate`}>
                <div className="section-head">
                  <h4 id={`${id}-rate`} style={{ margin: 0 }}>
                    Interest-rate shock
                  </h4>
                  <Sub>{formatMoney(result.variableDebt)} variable debt</Sub>
                </div>
                <FilterGroup label="Rate shock" value={shock} onChange={setShock} options={SHOCK_OPTIONS} />
                <Sub style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                  Applies to {plural(facilityCount, 'variable facility', 'variable facilities')}.{' '}
                  {inputs.fixedFacilityCount > 0
                    ? `Fixed-rate debt of ${formatMoney(inputs.fixedDebt)} is unaffected until its review date.`
                    : 'There is no fixed-rate debt.'}
                </Sub>
              </section>

              <section aria-labelledby={`${id}-vacancy`}>
                <div className="section-head">
                  <h4 id={`${id}-vacancy`} style={{ margin: 0 }}>
                    Vacancies
                  </h4>
                  <Sub>{formatMoney(result.rentalImpact)} rent lost</Sub>
                </div>
                {inputs.properties.length === 0 ? (
                  <Sub>No rented properties to simulate.</Sub>
                ) : (
                  <ul className="list">
                    {inputs.properties.map((property) => {
                      const checkboxId = `${id}-vacant-${property.propertyId}`;
                      const alreadyVacant = property.monthlyRent.cents === 0;
                      return (
                        <li key={property.propertyId}>
                          <input
                            type="checkbox"
                            id={checkboxId}
                            checked={vacant.includes(property.propertyId)}
                            disabled={alreadyVacant}
                            onChange={(event) => toggleVacant(property.propertyId, event.target.checked)}
                          />
                          <label htmlFor={checkboxId} className="li-main">
                            <b>{property.name}</b>
                            <span>
                              {alreadyVacant
                                ? 'No live lease · nothing to lose'
                                : `${formatMoney(property.monthlyRent)} / month · ${plural(property.leaseCount, 'lease')}`}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section aria-labelledby={`${id}-result`} aria-live="polite">
                <div className="section-head">
                  <h4 id={`${id}-result`} style={{ margin: 0 }}>
                    Result
                  </h4>
                  {outcomeChip(result)}
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <Kpi
                    label="Adjusted monthly cash flow"
                    value={formatMoney(result.simulatedCashFlow)}
                    valueStyle={result.simulatedCashFlow.cents < 0 ? { color: 'var(--bad)' } : undefined}
                    footer={
                      <>
                        <Delta direction={deltaDirection}>{formatMoney(absolute(result.monthlyDelta))}</Delta>
                        vs {formatMoney(result.baselineCashFlow)} baseline
                      </>
                    }
                  />
                  <Kpi
                    label="Additional monthly interest"
                    value={formatMoney(result.interestImpact)}
                    footer={
                      hasShock
                        ? `+${result.rateDeltaPercent.toFixed(2)}% on ${plural(facilityCount, 'variable facility', 'variable facilities')}`
                        : 'No rate change applied'
                    }
                  />
                  <Kpi
                    label={`Projected ${result.bufferMonths}-month buffer impact`}
                    value={formatMoney(result.bufferImpact)}
                    valueStyle={result.bufferImpact.cents < 0 ? { color: 'var(--bad)' } : undefined}
                    footer={`Monthly change × ${result.bufferMonths} months · what a cash reserve would need to absorb`}
                  />
                </div>
              </section>

              {hasShock && result.facilities.length > 0 ? (
                <section aria-labelledby={`${id}-facilities`}>
                  <div className="section-head">
                    <h4 id={`${id}-facilities`} style={{ margin: 0 }}>
                      By facility
                    </h4>
                    <Sub>{formatMoney(result.baselineVariableInterest, { showCents: true })} interest now</Sub>
                  </div>
                  <ul className="list">
                    {result.facilities.map((facility) => (
                      <li key={facility.loanId}>
                        <div className="li-main">
                          <b>{facility.label}</b>
                          <span>
                            {formatMoney(facility.balance)} · {formatPercent(facility.annualRate, 2)} →{' '}
                            {formatPercent(facility.simulatedRate, 2)}
                          </span>
                        </div>
                        <b className="num">{formatMoney(facility.additionalInterest, { showCents: true, signed: true })}</b>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <Sub style={{ display: 'block', fontSize: 12 }}>
                Interest is one month of simple interest on the current balance; repayments are not re-amortised. A
                vacancy removes the whole property&rsquo;s live rent for the month.
              </Sub>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
