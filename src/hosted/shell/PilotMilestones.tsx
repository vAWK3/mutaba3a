/* eslint-disable react-refresh/only-export-components */
import { useEffect } from 'react';
import { create } from 'zustand';
import { CloseIcon } from '../../components/ui/drawer/DrawerFrame';
import { useT } from '../../lib/i18n/core';
import { Scene } from '../components/Scene';
import { firstsReached, nextFirstsMemory, readFirstsMemory, writeFirstsMemory, type PilotFirst } from '../data/pilot';
import { usePilot } from '../data/pilotQueries';
import { useMe } from '../session/me';

/**
 * Pilot milestones (plan S5, journey steps 3–4): a small "you did it" on a tester's first scan and first invoice,
 * pilot only. Driven by GET /v1/billing `pilot.firstScanAt` / `firstInvoiceAt` (ADR-298): a first counts when this
 * browser read it null before and reads it set now (`firstsReached`), once each. The card shows the milestone's scene
 * with `motion-milestone`, says what happened, and leaves on its own; reduced motion shows the still.
 */

/** Long enough to read two words after the 0.94 s motion; it can be closed sooner. */
export const MILESTONE_SHOWN_MS = 4000;

interface MilestoneQueue {
  queue: PilotFirst[];
  reach: (firsts: PilotFirst[]) => void;
  dismiss: () => void;
}

/** Ephemeral, like the saved flash: a reload never replays a celebration (the memory in pilot.ts says it happened). */
export const usePilotMilestones = create<MilestoneQueue>((set) => ({
  queue: [],
  reach: (firsts) => set((s) => ({ queue: [...s.queue, ...firsts.filter((f) => !s.queue.includes(f))] })),
  dismiss: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

/** Reads each billing answer once: remembers the firsts still null, and queues the ones just reached. */
export function PilotMilestones() {
  const me = useMe();
  const { pilot } = usePilot();
  const reach = usePilotMilestones((s) => s.reach);
  const userId = me.user.id;
  useEffect(() => {
    if (!pilot) return;
    const memory = readFirstsMemory(userId);
    const reached = firstsReached(pilot, memory);
    writeFirstsMemory(userId, nextFirstsMemory(pilot, memory));
    if (reached.length > 0) reach(reached);
  }, [pilot, userId, reach]);
  return <MilestoneCard />;
}

function MilestoneCard() {
  const t = useT();
  const current = usePilotMilestones((s) => s.queue[0] ?? null);
  const dismiss = usePilotMilestones((s) => s.dismiss);
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(dismiss, MILESTONE_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);
  return (
    <div className="hp-milestone-region" aria-live="polite">
      {current && (
        <div key={current} className="hp-milestone" data-testid={`milestone-${current}`}>
          <Scene name={current === 'scan' ? 'milestone-first-scan' : 'milestone-first-invoice'} size={120} className="hp-milestone-art" />
          <span className="hp-milestone-text">{t(`hosted.pilot.milestone.${current}`)}</span>
          <button type="button" className="hp-milestone-close press" aria-label={t('common.close')} onClick={dismiss}>
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}
