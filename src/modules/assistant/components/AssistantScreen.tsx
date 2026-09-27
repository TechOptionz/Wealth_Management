'use client';

import Link from 'next/link';
import { ActionForm } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { TextField } from '@/shared/components/Field';
import { Row, Stack, Sub } from '@/shared/components/Layout';
import { askAssistantAction } from '../actions';
import type { AssistantRequest } from '../model';

export interface AssistantScreenProps {
  readonly projectId: string;
  readonly history: readonly AssistantRequest[];
  readonly enabled: boolean;
  readonly suggestions: readonly string[];
}

const KIND_CHIP = {
  fact: { tone: 'good' as const, icon: 'i-check' as const, label: 'Recorded fact' },
  forecast: { tone: 'info' as const, icon: 'i-calc' as const, label: 'Forecast' },
  note: { tone: 'neutral' as const, icon: 'i-clock' as const, label: 'Note' },
};

/** AI01–AI08 — permission-aware, read-only project questions. */
export function AssistantScreen({ projectId, history, enabled, suggestions }: AssistantScreenProps) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <Stack>
      <Banner tone="info" icon="i-shield" title="Read-only Assistant · no language-model provider connected">
        Answers come from the same calculation as the Cashflow and Summary screens, through tools that check your access first. It cannot
        approve, change or pay anything, and text inside invoices or comments is never treated as an instruction.
      </Banner>
      {!enabled ? <Banner tone="warn" title="The Assistant is turned off for this organisation">Every screen keeps working without it.</Banner> : null}

      <Card>
        <CardHeader title="Ask about this project" />
        <CardBody className="stack">
          <ActionForm action={askAssistantAction} submitLabel="Ask" hiddenFields={{ projectId }}>
            {({ fieldErrors }) => (
              <TextField id="as-q" name="question" label="Question" placeholder="Which costs are over baseline?" invalid={Boolean(fieldErrors.question)} hint={fieldErrors.question?.[0]} />
            )}
          </ActionForm>
          <Row>
            <Sub style={{ fontSize: 12 }}>Try:</Sub>
            {suggestions.map((suggestion) => (
              <Chip key={suggestion} tone="neutral">{suggestion}</Chip>
            ))}
          </Row>
        </CardBody>
      </Card>

      {[...history].reverse().map((request) => (
        <Card key={request.id}>
          <CardHeader
            title={request.question}
            aside={
              <Sub>
                {request.at.replace('T', ' ').slice(0, 16)} UTC · {request.answer.toolsUsed.join(', ') || 'no tools'}
                {request.answer.runId ? ` · run rev ${request.answer.modelRevision}` : ''}
              </Sub>
            }
          />
          <ul className="list">
            {request.answer.lines.map((line, index) => (
              <li key={index}>
                <Chip tone={KIND_CHIP[line.kind].tone} icon={KIND_CHIP[line.kind].icon}>{KIND_CHIP[line.kind].label}</Chip>
                <div className="li-main"><span style={{ whiteSpace: 'normal', color: 'var(--text)', fontSize: 13 }}>{line.text}</span></div>
              </li>
            ))}
          </ul>
          {request.answer.citations.length > 0 ? (
            <CardBody>
              <Row>
                <Sub style={{ fontSize: 12 }}>Sources:</Sub>
                {request.answer.citations.map((citation) => (
                  <Link key={`${citation.href}:${citation.label}`} className="btn sm" href={`${base}/${citation.href}`}>{citation.label}</Link>
                ))}
                {request.answer.stale ? <Chip tone="warn" icon="i-alert">Stale data</Chip> : null}
              </Row>
            </CardBody>
          ) : null}
        </Card>
      ))}
    </Stack>
  );
}
