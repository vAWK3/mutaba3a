import { Fragment, useCallback, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import '../../../components/ui/Table.css';
import { getLocale, useLanguage } from '../../../lib/i18n/core';
import { usePrefersReducedMotion } from '../../../lib/motion/mediaQuery';
import { captureRowExit } from '../../../lib/motion/rowExit';
import { playRowEnter } from '../../../lib/motion/rowEnter';
import type { Expense, ExpenseGroup } from '../../api/client';
import { inWindow, motionKey, verbFor, type MemberDay, type RowList, type Verb } from '../../data/expenseGroups';
import { DecimalAmount } from '../../format/DecimalAmount';

/**
 * A group's members by day, oldest first (MUT-268 4A), then Left out (22A).
 * Day headers and rows share one `<tbody>`, so a leaving row's followers glide
 * up into its gap (captureRowExit walks siblings, eng R12). A row the page
 * takes away slides toward the inline end; a row Undo brings back retraces
 * that path (craft spec 1–2). Focus goes to the next row's action when a row
 * leaves, and back to the row when it returns (PATTERNS: row exit focus).
 */

export interface RowMotion {
  /** `list:id` of rows the page is about to remove: they slide out. */
  leaving: Set<string>;
  /** `list:id` of rows the page is bringing back: they slide in and take focus. */
  returning: Set<string>;
}

export interface GroupMembersProps {
  group: ExpenseGroup;
  days: MemberDay[];
  excluded: Expense[];
  /** Phone layout (21A): no Category column, category under the title. */
  narrow: boolean;
  categoryName: (row: Expense) => string;
  dayLabel: (position: MemberDay['position'], date: string) => string | null;
  verbLabel: (verb: Verb) => string;
  onAct: (verb: Verb, row: Expense, list: RowList) => void;
  motion: RefObject<RowMotion>;
  /** Shown above the member table (the category filter, 13A). */
  filterBar?: ReactNode;
  excludedOpen: boolean;
  excludedError?: ReactNode;
  labels: { members: string; leftOut: string; kept: string; untitled: string; columns: { title: string; category: string; amount: string; action: string } };
  /** Where focus goes when the last row of a list leaves. */
  fallbackFocus: RefObject<HTMLElement | null>;
}

const dayId = (groupId: string, date: string) => `group-${groupId}-day-${date}`;

export function GroupMembers(props: GroupMembersProps) {
  const { group, days, excluded, narrow, labels, filterBar, excludedOpen, excludedError } = props;
  const { language } = useLanguage();
  const sectionRef = useRef<HTMLElement>(null);
  const leftOutRef = useRef<HTMLElement>(null);
  const weekday = new Intl.DateTimeFormat(getLocale(language), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const textColumns = narrow ? 1 : 2;

  const header = (
    <thead>
      <tr>
        <th scope="col">{labels.columns.title}</th>
        {!narrow && <th scope="col">{labels.columns.category}</th>}
        <th scope="col" className="hp-num">
          {labels.columns.amount}
        </th>
        <th scope="col">
          <span className="sr-only">{labels.columns.action}</span>
        </th>
      </tr>
    </thead>
  );

  return (
    <>
      <section ref={sectionRef} className="hp-members" aria-labelledby={`group-${group.id}-members`}>
        <h2 id={`group-${group.id}-members`} className="hp-section-title">
          {labels.members}
        </h2>
        {filterBar}
        {days.length > 0 && (
          <div className="table-wrapper hp-table-wrapper">
            <table className="table hp-members-table" aria-labelledby={`group-${group.id}-members`}>
              {header}
              <tbody>
                {days.map((day) => {
                  const note = props.dayLabel(day.position, day.date);
                  // Keyed per day: rows on later days keep their DOM nodes when a day empties (focus and glide follow them)
                  return (
                    <Fragment key={day.date}>
                      <tr id={dayId(group.id, day.date)} className="hp-dayhead" tabIndex={-1}>
                        <th scope="rowgroup" colSpan={textColumns}>
                          {weekday.format(new Date(`${day.date}T00:00:00Z`))}
                          {note && <span className="hp-dayhead-note"> · {note}</span>}
                        </th>
                        <td className="hp-num">
                          {day.subtotals.map((s, i) => (
                            <span key={s.currency}>
                              {i > 0 && ' · '}
                              <DecimalAmount value={s.total} currency={s.currency} />
                            </span>
                          ))}
                        </td>
                        <td />
                      </tr>
                      {day.rows.map((row) => (
                        <MemberRow key={row.id} {...props} row={row} list="member" container={sectionRef} />
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {(excluded.length > 0 || excludedError) && (
        <section ref={leftOutRef} className="hp-members hp-leftout">
          <details open={excludedOpen || Boolean(excludedError) || undefined}>
            <summary>{labels.leftOut}</summary>
            {excludedError}
            <div className="table-wrapper hp-table-wrapper">
              <table className="table hp-members-table" aria-label={labels.leftOut}>
                {header}
                <tbody>
                  {excluded.map((row) => (
                    <MemberRow key={row.id} {...props} row={row} list="excluded" container={leftOutRef} />
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
    </>
  );
}

const ACTION_CLASS = 'hp-row-act';

/** The nearest other row's action: the next one down, else the one above. */
function nextAction(row: HTMLElement): HTMLElement | null {
  for (const step of ['nextElementSibling', 'previousElementSibling'] as const) {
    for (let node = row[step]; node; node = node[step]) {
      const action = node.querySelector<HTMLElement>(`.${ACTION_CLASS}`);
      if (action) return action;
    }
  }
  return null;
}

const focusIsLost = () => document.activeElement === null || document.activeElement === document.body;

function MemberRow({ row, list, group, narrow, categoryName, verbLabel, onAct, motion, labels, container, fallbackFocus }: GroupMembersProps & { row: Expense; list: RowList; container: RefObject<HTMLElement | null> }) {
  const element = useRef<HTMLTableRowElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const verb = verbFor(list, row.occurredOn, group);
  const kept = list === 'member' && !inWindow(row.occurredOn, group);
  const key = motionKey(list, row.id);

  const arrive = useCallback(() => {
    const tr = element.current;
    const motions = motion.current;
    if (!tr || !motions?.returning.has(key)) return;
    motions.returning.delete(key);
    playRowEnter(tr, { reducedMotion });
    if (focusIsLost()) tr.querySelector<HTMLElement>(`.${ACTION_CLASS}`)?.focus({ preventScroll: true });
  }, [key, motion, reducedMotion]);

  useLayoutEffect(() => {
    arrive();
    const tr = element.current;
    // All three are stable for the row's life: the page's motion sets, its section, and its heading ref.
    const motions = motion.current;
    const section = container.current;
    const fallback = fallbackFocus;
    return () => {
      if (!tr || !section || !motions?.leaving.has(key)) return;
      const exit = captureRowExit(tr, section);
      const hadFocus = tr.contains(document.activeElement);
      const next = nextAction(tr);
      queueMicrotask(() => {
        if (tr.isConnected) return; // StrictMode's rehearsal: still here
        motions.leaving.delete(key);
        exit?.play({ reducedMotion });
        if (hadFocus && focusIsLost()) (next?.isConnected ? next : fallback.current)?.focus({ preventScroll: true });
      });
    };
    // The row's own life: arrive once, leave once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = row.title || labels.untitled;
  return (
    <tr ref={element} className={list === 'excluded' ? 'hp-member hp-member-out' : 'hp-member'}>
      <td>
        <span className="hp-member-title">{title}</span>
        {kept && <span className="hp-kept">{labels.kept}</span>}
        {narrow && <span className="hp-member-sub">{categoryName(row)}</span>}
      </td>
      {!narrow && <td>{categoryName(row)}</td>}
      <td className="hp-num">
        <DecimalAmount value={row.amount} currency={row.currency} />
      </td>
      <td className="hp-member-action">
        <button type="button" className={`btn btn-secondary btn-sm press hp-row-action ${ACTION_CLASS}`} aria-label={`${verbLabel(verb)}: ${title}`} onClick={() => onAct(verb, row, list)}>
          {verbLabel(verb)}
        </button>
      </td>
    </tr>
  );
}
