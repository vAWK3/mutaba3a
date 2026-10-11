import { useCallback, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { api, type Attachment, type Customer } from '../../api/client';
import { ClientFilter, FilterBar, SelectFilter } from '../../components/FilterControls';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView } from '../../components/QueryView';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { useToast } from '../../components/Toast';
import { downloadNavigator } from '../../data/download';
import { DOCUMENT_KINDS, isNarrowed, type DocumentFilters } from '../../data/filters';
import { useAttachments, useCustomerDirectory } from '../../data/queries';
import { formatInstant, formatSize } from '../../format/dates';
import { useProfile } from '../../session/me';
import { NoMatch, PageHeader, ShowMore } from './shared';

/**
 * Documents (hosted-portal.md §7.3): invoices and receipts, download only. A
 * download asks the server for a 15-minute signed URL and navigates to it; the
 * file is never previewed or rendered inside the portal (ADR-028).
 */

interface DocumentRow {
  id: string;
  filename: string;
  kind: string;
  client: string;
  invoice: string;
  added: string;
  size: string;
  ready: boolean;
}

interface DocumentsListProps {
  filters: DocumentFilters;
  setFilters: (next: DocumentFilters) => void;
  fixedCustomerId?: string;
}

export function DocumentsList({ filters, setFilters, fixedCustomerId }: DocumentsListProps) {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const toast = useToast();
  const list = useAttachments(profile.id, fixedCustomerId ? { ...filters, customerId: fixedCustomerId } : filters);
  const customers = useCustomerDirectory(profile.id);
  const [preparing, setPreparing] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      list.data && customers.data
        ? list.data.map((a: Attachment) => shape(a, customers.data as Map<string, Customer>, language, profile.timezone, (k) => t(`hosted.documents.kind.${k}`)))
        : undefined,
    [list.data, customers.data, language, profile.timezone, t],
  );

  const download = useCallback(
    async (row: DocumentRow) => {
      setPreparing(row.id);
      try {
        const { url } = await api.attachmentDownload(profile.id, row.id);
        downloadNavigator.open(url);
      } catch {
        toast(t('hosted.documents.downloadFailed'));
      } finally {
        setPreparing(null);
      }
    },
    [profile.id, toast, t],
  );

  const columns = useMemo<Column<DocumentRow>[]>(
    () => [
      {
        key: 'name',
        header: t('hosted.documents.columns.name'),
        cell: (r) => (
          <>
            <bdi>{r.filename}</bdi>
            {!r.ready && <span className="hp-muted hp-inline-note">{t('hosted.documents.uploading')}</span>}
          </>
        ),
      },
      { key: 'kind', header: t('hosted.documents.columns.kind'), cell: (r) => r.kind },
      ...(fixedCustomerId ? [] : [{ key: 'client', header: t('hosted.documents.columns.client'), cell: (r: DocumentRow) => r.client }]),
      { key: 'invoice', header: t('hosted.documents.columns.invoice'), cell: (r) => <bdi dir="ltr">{r.invoice}</bdi> },
      { key: 'added', header: t('hosted.documents.columns.added'), cell: (r) => r.added },
      { key: 'size', header: t('hosted.documents.columns.size'), numeric: true, cell: (r) => r.size },
      {
        key: 'download',
        header: '',
        cell: (r) =>
          r.ready ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('hosted.documents.downloadNamed', { name: r.filename })}
              disabled={preparing === r.id}
              onClick={() => void download(r)}
            >
              {t(preparing === r.id ? 'hosted.documents.preparing' : 'hosted.documents.download')}
            </Button>
          ) : null,
      },
    ],
    [t, fixedCustomerId, preparing, download],
  );

  const patch = (change: Partial<DocumentFilters>) => setFilters({ ...filters, ...change });

  return (
    <>
      <ReadOnlyNotice profile={profile} />
      <FilterBar>
        {!fixedCustomerId && <ClientFilter value={filters.customerId} options={customers.data} onChange={(customerId) => patch({ customerId })} />}
        <SelectFilter
          label={t('hosted.filters.kind')}
          value={filters.kind}
          options={DOCUMENT_KINDS.map((kind) => ({ value: kind, label: t(`hosted.documents.kind.${kind}`) }))}
          onChange={(kind) => patch({ kind })}
        />
      </FilterBar>
      <QueryView
        queries={[list, customers]}
        data={rows}
        isEmpty={(r) => r.length === 0}
        empty={
          isNarrowed(filters) ? (
            <NoMatch onClear={() => setFilters({})} />
          ) : (
            <Empty title={t('hosted.documents.empty.title')} body={t('hosted.documents.empty.body')} />
          )
        }
      >
        {(r) => (
          <>
            <HostedTable label={t('hosted.documents.title')} columns={columns} rows={r} rowKey={(row) => row.id} />
            <ShowMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </>
        )}
      </QueryView>
    </>
  );
}

function shape(a: Attachment, customers: Map<string, Customer>, language: 'en' | 'ar', timeZone: string, kindLabel: (kind: string) => string): DocumentRow {
  return {
    id: a.id,
    filename: a.filename,
    kind: kindLabel(a.kind),
    client: (a.customerId && customers.get(a.customerId)?.name) || '—',
    invoice: a.invoiceNumber ?? '—',
    added: formatInstant(a.createdAt, language, timeZone),
    size: formatSize(a.sizeBytes, language),
    ready: a.status === 'READY',
  };
}

export function DocumentsPage(props: Omit<DocumentsListProps, 'fixedCustomerId'>) {
  const { t } = useLanguage();
  return (
    <>
      <PageHeader title={t('hosted.documents.title')} />
      <DocumentsList {...props} />
    </>
  );
}
