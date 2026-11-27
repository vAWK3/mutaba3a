import { Badge } from '../../../components/ui/Badge';
import { useT } from '../../../lib/i18n/core';
import type { DeskState } from './deskRules';

/** The badge's colour per state (DR-9): always with the word, never colour alone. */
const VARIANT: Record<DeskState, 'neutral' | 'warning' | 'info' | 'success'> = {
  await: 'neutral',
  expired: 'warning',
  card: 'warning',
  activating: 'info',
  active: 'success',
  ended: 'neutral',
};

export function DeskBadge({ state }: { state: DeskState }) {
  const t = useT();
  return (
    <Badge variant={VARIANT[state]} size="sm">
      {t(`hosted.desk.states.${state}`)}
    </Badge>
  );
}
