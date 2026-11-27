import { ActivatingStatus } from '../../components/ActivatingStatus';
import { useActivatingPoll } from '../../data/activatingPoll';
import type { DeskRow } from './deskRules';

/**
 * MUT-768 (accountant channel, DR-5): what the desk says while a customer's card is being activated. One status per
 * customer the accountant sent to Stripe this session: MUT-770's `useActivatingPoll` asks the list again every 4 s for
 * 2 minutes, `ActivatingStatus` shows Activating…, Active or Check back shortly with its live region. Closing one
 * forgets the mark. The row's own badge (deskRules) says Activating for the same two minutes.
 */
interface ItemProps {
  name: string;
  startedAt: number;
  paid: boolean;
  poll: () => void;
  onClose: () => void;
}

function ActivatingCustomer({ name, startedAt, paid, poll, onClose }: ItemProps) {
  const phase = useActivatingPoll({ startedAt, paid, poll });
  return <ActivatingStatus name={name} phase={phase} onClose={onClose} />;
}

export function DeskActivating({ rows, marks, poll, onClose }: { rows: readonly DeskRow[]; marks: Record<string, number>; poll: () => void; onClose: (userId: string) => void }) {
  const waiting = rows.flatMap((row) => (row.customer && marks[row.customer.userId] !== undefined ? [{ row, startedAt: marks[row.customer.userId]! }] : []));
  if (waiting.length === 0) return null;
  return (
    <div className="hp-desk-activating">
      {waiting.map(({ row, startedAt }) => (
        <ActivatingCustomer key={row.customer!.userId} name={row.name} startedAt={startedAt} paid={row.customer!.paid} poll={poll} onClose={() => onClose(row.customer!.userId)} />
      ))}
    </div>
  );
}
