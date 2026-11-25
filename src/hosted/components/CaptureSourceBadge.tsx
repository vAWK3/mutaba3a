import { Badge } from '../../components/ui/Badge';
import { useT } from '../../lib/i18n/core';

/** The capture sources that name who acted for the person: their own Claude (MUT-436) or Malafat (MUT-596). */
const NAMED: Record<string, { key: string; slot: string; name: string }> = {
  mcp: { key: 'hosted.expenses.drawer.addedByClaude', slot: '{claude}', name: 'Claude' },
  malafat: { key: 'hosted.viaMalafat', slot: '{malafat}', name: 'Malafat' },
};

/**
 * MUT-436 (AC5), MUT-596: a record someone acted on for the person (captureSource 'mcp' or 'malafat', ADR-201,
 * ADR-254). The name stays Latin and left-to-right inside an Arabic sentence (<bdi>, ADR-101). Nothing for any other
 * source: a person's own capture needs no label.
 */
export function CaptureSourceBadge({ source }: { source: string | null | undefined }) {
  const t = useT();
  const named = source ? NAMED[source] : undefined;
  if (!named) return null;
  const [before, after = ''] = t(named.key).split(named.slot);
  return (
    <Badge variant="info" size="sm">
      {before}
      <bdi>{named.name}</bdi>
      {after}
    </Badge>
  );
}
