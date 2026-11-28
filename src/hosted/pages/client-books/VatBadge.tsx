import { Badge } from '../../../components/ui/Badge';
import { useT } from '../../../lib/i18n/core';
import { StateClientSentIcon, StateConfirmedIcon, StateMoreNeededIcon, StateWaitingIcon } from '../../components/VatIcons';
import { VAT_STATE_VARIANT, type VatState } from './vatPeriodRules';

/** The glyph beside each state's word (Claude Design): the word is the meaning, the glyph and colour only help. */
const GLYPH: Record<VatState, () => React.JSX.Element> = {
  OPEN: () => <StateWaitingIcon width={14} height={14} />,
  CLIENT_DONE: () => <StateClientSentIcon width={14} height={14} />,
  CONFIRMED: () => <StateConfirmedIcon width={14} height={14} />,
  MORE_NEEDED: () => <StateMoreNeededIcon width={14} height={14} />,
};

/** MUT-783: a VAT period's state on the desk row, in the drawer and on the client's card (always the word, never colour alone). */
export function VatBadge({ state }: { state: VatState }) {
  const t = useT();
  const Glyph = GLYPH[state];
  return (
    <Badge variant={VAT_STATE_VARIANT[state]} size="sm" className="hp-vat-badge">
      <Glyph />
      {t(`hosted.vat.states.${state}`)}
    </Badge>
  );
}

