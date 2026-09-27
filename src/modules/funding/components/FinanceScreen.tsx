'use client';

import { useState } from 'react';
import { Banner } from '@/shared/components/Banner';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { Stack, Sub } from '@/shared/components/Layout';
import { Tabs } from '@/shared/components/Tabs';
import { formatDateLong } from '@/shared/lib/dates';
import type { FinanceScreenData, ParticipationView } from '../api';
import { DebtTab } from './DebtTab';
import { CapitalAccountCard, EquityTab } from './EquityTab';
import { WaterfallTab } from './WaterfallTab';
import { whole } from './format';

type Tab = 'debt' | 'equity' | 'waterfall';

/** /projects/[projectId]/finance — debt, equity and the distribution waterfall (FIN, EQ, WFL). */
export function FinanceScreen({ data }: { readonly data: FinanceScreenData }) {
  const [tab, setTab] = useState<Tab>('debt');
  return (
    <Stack>
      <Tabs
        tabs={[
          { value: 'debt', label: 'Debt' },
          { value: 'equity', label: 'Equity' },
          { value: 'waterfall', label: 'Waterfall' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'debt' ? <DebtTab data={data} /> : null}
      {tab === 'equity' ? <EquityTab data={data} /> : null}
      {tab === 'waterfall' ? <WaterfallTab data={data} /> : null}
    </Stack>
  );
}

/** What an investor sees: their own participation and nothing else (EQ03). */
export function ParticipationScreen({ view }: { readonly view: ParticipationView }) {
  return (
    <Stack>
      <Banner tone="info" icon="i-shield" title={`Your participation in ${view.project.name}`}>
        You see your own capital account only. Other participants, facilities and project financials are not shared with investors.
      </Banner>
      <KpiGrid>
        <Kpi label="Commitment" value={whole(view.participant.commitment)} footer={<Sub>{view.participant.investorReference}</Sub>} />
        <Kpi label="Outstanding capital" value={whole(view.account.outstanding)} footer={<Sub>Remaining commitment {whole(view.remainingCommitment)}</Sub>} />
        <Kpi label="Preferred return owed" value={whole(view.account.preferredOutstanding)} footer={<Sub>{view.preferredRateLabel} simple · ACT/365F</Sub>} />
        <Kpi label="IRR to date" value={view.irr.available ? view.irrLabel : '—'} footer={<Sub>{view.irr.available ? `As of ${formatDateLong(view.asOf)}` : view.irrLabel}</Sub>} />
      </KpiGrid>
      <CapitalAccountCard
        name={view.participant.name}
        account={view.account}
        remaining={view.remainingCommitment}
        irrLabel={view.irrLabel}
        movements={view.movements}
        asOf={view.asOf}
      />
    </Stack>
  );
}
