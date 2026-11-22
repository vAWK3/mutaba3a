import { useMemo, useState, type ReactNode } from 'react';
import { FileIcon } from '../../components/icons/generated';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import type { Currency, ExternalEntryKind, ExternalInvoice } from '../api/client';
import { useExternalInvoices } from '../data/externalInvoiceQueries';
import { useIssuingSetup } from '../data/issuingQueries';
import { useProfile, useWriteGate } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { AttachExternalInvoiceDrawer } from './AttachExternalInvoiceDrawer';
import type { Column } from './HostedTable';

/**
 * MUT-647: the Document column on Owed and Received (round 3). An entry with an invoice issued elsewhere shows it
 * (document icon, "Issued elsewhere"); one without offers Attach, and takes a file dropped on its row. Only where
 * issuing is on for the profile (the setup answers), never signed out or on a personal profile. Rows MTB3A issued a
 * document for take nothing. An accountant sees what is attached and opens it, and attaches nothing.
 */
export interface ExternalRow {
  id: string;
  client: string;
  currency: Currency;
}

interface Picked {
  id: string;
  existing: ExternalInvoice | null;
  file: File | null;
}

/**
 * `extra` (MUT-648's Issue a tax invoice on Owed) shares the column: it shows beside Attach, and goes with it once an
 * invoice issued elsewhere is attached (the server would refuse the issue then: EXTERNAL_INVOICE_ATTACHED).
 */
export function useExternalInvoiceColumn<Row extends ExternalRow>(
  kind: ExternalEntryKind,
  rows: readonly Row[] | undefined,
  amountOf: (row: Row) => string,
  eligible: (row: Row) => boolean = () => true,
  extra?: (row: Row) => ReactNode,
) {
  const profile = useProfile();
  const local = useIsLocalMode();
  const { writable } = useWriteGate();
  const { t } = useLanguage();
  const on = !local && profile.type !== 'PERSONAL';
  const setup = useIssuingSetup(profile.id, on);
  const shown = on && Boolean(setup.data);
  const ids = useMemo(() => (rows ?? []).filter(eligible).map((r) => r.id), [rows, eligible]);
  const attached = useExternalInvoices(profile.id, kind, ids, shown);
  const [picked, setPicked] = useState<Picked | null>(null);
  const byId = attached.data;

  const column = useMemo<Column<Row> | undefined>(
    () =>
      shown
        ? {
            key: 'document',
            header: t('hosted.external.column'),
            cell: (row: Row) => {
              if (!eligible(row)) return null;
              const existing = byId?.get(row.id);
              if (existing) {
                return (
                  <button
                    type="button"
                    className="hp-external-chip press"
                    data-testid={`external-badge-${row.id}`}
                    aria-label={t('hosted.external.showRow', { number: existing.number, client: row.client })}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPicked({ id: row.id, existing, file: null });
                    }}
                  >
                    <FileIcon size={14} className="hp-external-glyph" />
                    <span>{t('hosted.external.badge')}</span>
                  </button>
                );
              }
              const attach = writable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hp-row-action"
                  data-testid={`external-attach-${row.id}`}
                  aria-label={t('hosted.external.attachRow', { client: row.client })}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPicked({ id: row.id, existing: null, file: null });
                  }}
                >
                  {t('hosted.external.attachShort')}
                </Button>
              ) : null;
              const offered = extra?.(row);
              return offered ? (
                <span className="hp-row-actions">
                  {offered}
                  {attach}
                </span>
              ) : (
                attach
              );
            },
          }
        : undefined,
    [shown, t, eligible, byId, writable, extra],
  );

  const canDrop = writable && shown;
  const onRowFileDrop = canDrop ? (row: Row, file: File) => setPicked({ id: row.id, existing: null, file }) : undefined;
  const canDropFile = (row: Row) => eligible(row) && Boolean(byId) && !byId?.has(row.id);

  const row = picked ? rows?.find((r) => r.id === picked.id) : undefined;
  const drawer: ReactNode =
    picked && row ? (
      <AttachExternalInvoiceDrawer
        key={`${picked.id}-${picked.existing?.id ?? 'new'}`}
        profile={profile}
        entry={{ kind, id: row.id, client: row.client, amount: amountOf(row), currency: row.currency }}
        existing={picked.existing}
        initialFile={picked.file}
        onClose={() => setPicked(null)}
      />
    ) : null;

  return { column, onRowFileDrop, canDropFile, drawer };
}
