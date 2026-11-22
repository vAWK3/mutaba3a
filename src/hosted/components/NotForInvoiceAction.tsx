import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { markRefusal, useSetEntryNotForInvoice } from '../data/documentsDueQueries';
import { useProfile } from '../session/me';
import { useToast } from './Toast';

/**
 * MUT-660 (wireframe screen 3): an Owed or Received row's "Not for invoice" / "Back to invoice", in the Document column
 * beside Attach (invoicing profiles only, where that column shows). A visible text action, never hidden in a menu. A
 * marked row shows a neutral badge. An entry with a tax document is refused by the server: the toast says a credit note
 * comes first. Undo puts the mark back as it was.
 */
export function NotForInvoiceAction({ kind, id, version, marked, client }: { kind: 'owed' | 'received'; id: string; version: number; marked: boolean; client: string }) {
  const { t } = useLanguage();
  const toast = useToast();
  const profile = useProfile();
  const set = useSetEntryNotForInvoice(profile.id);
  const flip = (value: boolean, at: number) =>
    set.mutate(
      { entry: { kind, id }, value, version: at },
      {
        onSuccess: (entry) =>
          toast(value ? t('hosted.documentsDue.rowMarked') : t('hosted.documentsDue.rowBack'), { tone: 'info', action: { label: t('hosted.documentsDue.undo'), onAction: () => flip(!value, entry.version) } }),
        onError: (error) => toast(markRefusal(error) === 'HAS_TAX_DOCUMENT' ? t('hosted.documentsDue.creditNoteFirst') : t('hosted.documentsDue.markFailed')),
      },
    );
  return (
    <span className="hp-row-actions">
      {marked && <Badge variant="neutral">{t('hosted.documentsDue.notForInvoice')}</Badge>}
      <Button
        variant="ghost"
        size="sm"
        className="hp-row-action"
        data-testid={`${marked ? 'nfi-back' : 'nfi-mark'}-${id}`}
        aria-label={t(marked ? 'hosted.documentsDue.backRow' : 'hosted.documentsDue.markRow', { client })}
        disabled={set.isPending}
        onClick={(event) => {
          event.stopPropagation();
          flip(!marked, version);
        }}
      >
        {marked ? t('hosted.documentsDue.back') : t('hosted.documentsDue.notForInvoice')}
      </Button>
    </span>
  );
}
