'use client';

import { useScrollToSelectedRow } from '@/shared/components/useScrollToSelectedRow';
import { useState } from 'react';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, type DataTableColumn } from '@/shared/components/DataTable';
import { FilterGroup } from '@/shared/components/FilterGroup';
import { Icon } from '@/shared/components/Icon';
import { Card as PanelCard, CardBody, CardHeader } from '@/shared/components/Card';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Stack, Sub, Toolbar } from '@/shared/components/Layout';
import { addDocumentVersionAction, linkDocumentAction, registerDocumentAction } from '../actions';
import { DOCUMENT_FILTER_LABELS, type DocumentFilter } from '../model';
import type { DocumentView } from '../service';

/** `type:id:label` — a link needs all three, so the option carries all three. */
export interface LinkTarget {
  readonly value: string;
  readonly label: string;
}

const FILTER_ORDER: readonly DocumentFilter[] = [
  'all',
  'leases',
  'insurance',
  'invoices-receipts',
  'loans',
  'valuations',
  'unlinked',
];

export interface DocumentsScreenProps {
  readonly rowsByFilter: Record<DocumentFilter, readonly DocumentView[]>;
  readonly counts: Record<DocumentFilter, number>;
  readonly linkTargets: readonly LinkTarget[];
  /** A document to highlight on arrival, e.g. from a global search result. */
  readonly focusDocumentId?: string;
}

/** FR-04 — the document register. */
export function DocumentsScreen({ rowsByFilter, counts, linkTargets, focusDocumentId }: DocumentsScreenProps) {
  const [filter, setFilter] = useState<DocumentFilter>('all');
  useScrollToSelectedRow(focusDocumentId);
  const [panel, setPanel] = useState<
    | { readonly kind: 'register' }
    | { readonly kind: 'link'; readonly view: DocumentView }
    | { readonly kind: 'new-version'; readonly view: DocumentView }
    | null
  >(null);
  const close = (): void => setPanel(null);

  const columns: readonly DataTableColumn<DocumentView>[] = [
    {
      header: 'Document',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.record.filename}</CellMain>
          <CellSub>
            {row.sizeLabel}
            {row.record.descriptor ? ` · ${row.record.descriptor}` : ''}
          </CellSub>
        </>
      ),
    },
    {
      header: 'Type',
      render: (row) =>
        row.linkLabel === null ? (
          <Chip tone="warn" icon="i-alert">
            Unlinked
          </Chip>
        ) : (
          <Chip tone="neutral">{row.typeLabel}</Chip>
        ),
    },
    {
      header: 'Linked to',
      render: (row) => row.linkLabel ?? <Sub>Not linked to any record</Sub>,
    },
    { header: 'Uploaded', render: (row) => row.uploadedLabel },
    {
      header: 'Versions',
      render: (row) => (
        <>
          {row.versionCount}
          {row.latestVersionNote ? <CellSub>{row.latestVersionNote}</CellSub> : null}
        </>
      ),
    },
    {
      header: '',
      mobileLabel: 'Action',
      align: 'right',
      render: (row) => (
        <>
          {row.linkLabel === null ? (
            <Button small onClick={() => setPanel({ kind: 'link', view: row })}>
              Link to record
            </Button>
          ) : (
            <Button small variant="ghost" onClick={() => setPanel({ kind: 'link', view: row })}>
              Add link
            </Button>
          )}{' '}
          <Button small variant="ghost" onClick={() => setPanel({ kind: 'new-version', view: row })}>
            New version
          </Button>
        </>
      ),
    },
  ];

  return (
    <Stack>
      <Toolbar>
        <FilterGroup
          label="Filter documents"
          options={FILTER_ORDER.map((value) => ({
            value,
            label: DOCUMENT_FILTER_LABELS[value],
            ...(value === 'all' || value === 'unlinked' ? { count: counts[value] } : {}),
          }))}
          value={filter}
          onChange={setFilter}
        />
        <Button variant="primary" onClick={() => setPanel({ kind: 'register' })}>
          <Icon name="i-upload" />
          Add document
        </Button>
      </Toolbar>

      {panel?.kind === 'register' ? (
        <PanelCard>
          <CardHeader title="Add document" aside={<Sub>Metadata only — no file is stored in this build</Sub>} />
          <CardBody>
            <ActionForm action={registerDocumentAction} submitLabel="Register document" onCancel={close} onSuccess={close}>
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextField
                    id="doc-filename" name="filename" label="File name" required
                    placeholder="Rates notice 166 Compton Rd Q2 2026.pdf"
                    invalid={Boolean(firstError(fieldErrors, 'filename'))}
                    hint={firstError(fieldErrors, 'filename')}
                  />
                  <SelectField
                    id="doc-type" name="type" label="Type" defaultValue="other"
                    options={[
                      { value: 'lease', label: 'Lease' },
                      { value: 'insurance-policy', label: 'Insurance policy' },
                      { value: 'bill', label: 'Bill' },
                      { value: 'invoice', label: 'Invoice' },
                      { value: 'receipt', label: 'Receipt' },
                      { value: 'loan', label: 'Loan' },
                      { value: 'valuation', label: 'Valuation' },
                      { value: 'other', label: 'Other' },
                    ]}
                  />
                  <SelectField
                    id="doc-target" name="target" label="Link to"
                    hint="Unlinked documents are flagged so they can be filed later"
                    options={[{ value: '', label: 'Not linked' }, ...linkTargets]}
                  />
                  <TextField id="doc-size" name="sizeMb" label="Size (MB)" defaultValue="0.5" />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        </PanelCard>
      ) : null}

      {panel?.kind === 'link' ? (
        <PanelCard>
          <CardHeader title={`Link · ${panel.view.record.filename}`} aside={<Sub>Links are additive</Sub>} />
          <CardBody>
            <ActionForm
              action={linkDocumentAction}
              submitLabel="Link document"
              onCancel={close}
              onSuccess={close}
              hiddenFields={{ documentId: panel.view.record.id }}
            >
              {({ fieldErrors }) => (
                <FieldGrid>
                  <SelectField
                    id="link-target" name="target" label="Link to" required
                    invalid={Boolean(firstError(fieldErrors, 'target'))}
                    hint={firstError(fieldErrors, 'target')}
                    options={[{ value: '', label: 'Choose a record…' }, ...linkTargets]}
                  />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        </PanelCard>
      ) : null}

      {panel?.kind === 'new-version' ? (
        <PanelCard>
          <CardHeader
            title={`New version · ${panel.view.record.filename}`}
            aside={<Sub>Becomes v{panel.view.versionCount + 1} — earlier versions are kept</Sub>}
          />
          <CardBody>
            <ActionForm
              key={panel.view.record.id}
              action={addDocumentVersionAction}
              submitLabel="Record new version"
              onCancel={close}
              onSuccess={close}
              hiddenFields={{ documentId: panel.view.record.id }}
            >
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextField
                    id="version-note" name="note" label="Version note"
                    placeholder="e.g. Annual renewal certificate"
                  />
                  <TextField
                    id="version-size" name="sizeMb" label="File size (MB)" defaultValue="1.2"
                    invalid={Boolean(firstError(fieldErrors, 'sizeMb'))}
                    hint={firstError(fieldErrors, 'sizeMb')}
                  />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        </PanelCard>
      ) : null}

      <Card>
        <DataTable
          columns={columns}
          rows={rowsByFilter[filter]}
          rowKey={(row) => row.record.id}
          isRowSelected={(row) => row.record.id === focusDocumentId}
          rowStyle={(row) => (row.record.id === focusDocumentId ? { background: 'var(--gold-soft)' } : undefined)}
          empty="No documents match this filter."
        />
      </Card>

      <Sub style={{ fontSize: 12 }}>
        Documents are never deleted from history — removing one hides it and records who removed it and when. Nothing
        here is sent to an AI model unless you approve that document for assisted extraction (Release 2).
      </Sub>
    </Stack>
  );
}
