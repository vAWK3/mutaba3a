import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { useT } from '../../../lib/i18n/core';
import type { OperatorAccount } from '../../api/client';

/** MUT-461 (design 5A): an account's status as a chip. A closing account reads as closing, whatever its status. */
const TONE: Record<OperatorAccount['status'] | 'closing', BadgeVariant> = {
  ACTIVE: 'success',
  DISABLED: 'error',
  PENDING_REVIEW: 'warning',
  closing: 'warning',
};

export function AccountStatusBadge({ status, closing = false }: { status: OperatorAccount['status']; closing?: boolean }) {
  const t = useT();
  const key = closing ? 'closing' : status;
  return (
    <Badge variant={TONE[key]} size="sm">
      {t(`hosted.operator.accounts.status.${key}`)}
    </Badge>
  );
}
