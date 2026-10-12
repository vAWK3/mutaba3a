import { useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { motionValue, type AnimationPlaybackControls } from 'motion';
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion';
import {
  rubberbandInverse,
  velocityFromSamples,
  VELOCITY_WINDOW_MS,
  type MotionSample,
} from '../../../lib/motion/physics';
import {
  classifyDrag,
  closingDelta,
  displayOffset,
  exitDistance,
  isNoDragTarget,
  releaseTarget,
  type DragIntent,
} from './drawerGesture';
import { fadeTo, paintDrawer, playSnapshotExit, springTo, type DrawerGeometry } from './drawerMotion';
import { captureExitSnapshot } from './exitSnapshot';

/** Added to the panel while a drag owns it (no text selection, grabbing cursor). */
export const DRAGGING_CLASS = 'is-dragging';

const SAMPLE_HISTORY_MS = VELOCITY_WINDOW_MS * 2;

interface Gesture {
  pointerId: number;
  intent: DragIntent;
  startX: number;
  startY: number;
  /** The raw (un-rubber-banded) offset at the press, so the grab point stays under the pointer. */
  startRaw: number;
  /** The press stopped a running animation, which must resume if no drag follows. */
  interrupted: boolean;
  samples: MotionSample[];
}

export interface DrawerMotionOptions {
  panelRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  /** Runs once a drag has carried the panel off-screen. */
  onDismiss: () => void;
}

/** Pointer handlers for the panel. */
export interface DrawerDragHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
}

function hasSelectionWithin(panel: HTMLElement): boolean {
  const selection = document.getSelection();
  return !!selection && !selection.isCollapsed && panel.contains(selection.anchorNode);
}

/**
 * The drawer's motion (MUT-80, brief R2, ADR-043): it springs in from its
 * edge, follows a horizontal drag 1:1 with a rubber band past open, decides a
 * release by projected momentum, can be caught at any moment, and leaves by
 * the edge it came from. `onDismiss` runs when a drag has carried the panel
 * off-screen. Every other close is the caller's: when the drawer unmounts
 * while visible, a snapshot of it plays the exit (see `exitSnapshot.ts`).
 */
export function useDrawerMotion({ panelRef, overlayRef, onDismiss }: DrawerMotionOptions): DrawerDragHandlers {
  const [offset] = useState(() => motionValue(0));
  const [presence] = useState(() => motionValue(1));
  const geometry = useRef<DrawerGeometry>({ width: 0, rtl: false });
  const animation = useRef<AnimationPlaybackControls | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const dismissed = useRef(false);
  const swallowClick = useRef(false);

  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const onDismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    reducedMotionRef.current = reducedMotion;
    onDismissRef.current = onDismiss;
  });

  function play(start: (done: () => void) => AnimationPlaybackControls, then?: () => void) {
    animation.current?.stop();
    const controls = start(() => {
      if (animation.current === controls) animation.current = null;
      then?.();
    });
    animation.current = controls;
  }

  function settle(velocity: number) {
    if (reducedMotionRef.current) {
      offset.jump(0);
      if (presence.get() < 1) play((done) => fadeTo(presence, 1, done));
      return;
    }
    presence.jump(1);
    play((done) => springTo(offset, 0, velocity, done));
  }

  function commitDismiss() {
    dismissed.current = true;
    flushSync(() => onDismissRef.current());
    // Still here: the caller kept the drawer open, so bring it back.
    if (panelRef.current?.isConnected) {
      dismissed.current = false;
      settle(0);
    }
  }

  function dismiss(velocity: number) {
    if (reducedMotionRef.current) play((done) => fadeTo(presence, 0, done), commitDismiss);
    else play((done) => springTo(offset, exitDistance(geometry.current.width), velocity, done), commitDismiss);
  }

  function release(velocity: number) {
    const target = releaseTarget(offset.get(), velocity, geometry.current.width);
    if (target === 'dismiss') dismiss(velocity);
    else settle(velocity);
  }

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (!panel || !overlay) return;
    const width = panel.offsetWidth;
    geometry.current = { width, rtl: panel.matches('[dir="rtl"] *') };
    const paint = () => paintDrawer(panel, overlay, { offset: offset.get(), presence: presence.get() }, geometry.current);
    const unsubscribe = [offset.on('change', paint), presence.on('change', paint)];

    // No layout (not rendered, or jsdom): nothing to slide, so no enter and no exit.
    if (width > 0) {
      if (reducedMotionRef.current) {
        presence.jump(0);
        animation.current = fadeTo(presence, 1, () => (animation.current = null));
      } else {
        offset.jump(exitDistance(width));
        animation.current = springTo(offset, 0, 0, () => (animation.current = null));
      }
      paint();
    }

    return () => {
      unsubscribe.forEach((stop) => stop());
      const velocity = offset.getVelocity();
      animation.current?.stop();
      animation.current = null;
      if (width === 0 || dismissed.current) return;

      const snapshot = captureExitSnapshot(overlay, panel);
      const from = { offset: offset.get(), presence: presence.get(), velocity };
      const exitGeometry = geometry.current;
      const reduced = reducedMotionRef.current;
      // StrictMode's simulated unmount leaves the panel in the document.
      queueMicrotask(() => {
        if (panel.isConnected) return;
        snapshot.attach();
        playSnapshotExit(snapshot, from, exitGeometry, reduced);
      });
    };
  }, [panelRef, overlayRef, offset, presence]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    swallowClick.current = false;
    const panel = panelRef.current;
    if (!panel || event.button !== 0 || !event.isPrimary) return;
    if (isNoDragTarget(event.target, panel) || hasSelectionWithin(panel)) return;
    const width = panel.offsetWidth;
    if (width === 0) return;
    geometry.current = { ...geometry.current, width };

    // Catch it where it is on screen: the motion value is the presentation value.
    const interrupted = animation.current !== null;
    animation.current?.stop();
    animation.current = null;
    const drawn = offset.get();
    gesture.current = {
      pointerId: event.pointerId,
      intent: 'pending',
      startX: event.clientX,
      startY: event.clientY,
      startRaw: drawn < 0 ? rubberbandInverse(drawn, width) : drawn,
      interrupted,
      samples: [{ time: performance.now(), position: closingDelta(event.clientX, geometry.current.rtl) }],
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    const panel = panelRef.current;
    if (!current || !panel || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;

    if (current.intent === 'pending') {
      current.intent = classifyDrag(dx, dy);
      if (current.intent === 'pending') return;
      if (current.intent === 'vertical') {
        // Scrolling wins this press; a motion it stopped picks up again.
        gesture.current = null;
        if (current.interrupted) release(0);
        return;
      }
      panel.setPointerCapture?.(event.pointerId);
      panel.classList.add(DRAGGING_CLASS);
      document.getSelection()?.removeAllRanges();
    }

    const { width, rtl } = geometry.current;
    const now = performance.now();
    current.samples.push({ time: now, position: closingDelta(event.clientX, rtl) });
    while (current.samples.length > 2 && now - current.samples[0].time > SAMPLE_HISTORY_MS) current.samples.shift();
    offset.set(displayOffset(current.startRaw + closingDelta(dx, rtl), width));
  }

  function endGesture(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    gesture.current = null;
    if (current.intent !== 'horizontal') {
      if (current.interrupted) release(0);
      return;
    }

    const panel = panelRef.current;
    panel?.classList.remove(DRAGGING_CLASS);
    if (panel?.hasPointerCapture?.(event.pointerId)) panel.releasePointerCapture(event.pointerId);
    // The click that ends a drag is not a click; a later keyboard click is.
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);

    if (cancelled) {
      release(0);
      return;
    }
    current.samples.push({ time: performance.now(), position: closingDelta(event.clientX, geometry.current.rtl) });
    release(velocityFromSamples(current.samples));
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event) => endGesture(event, false),
    onPointerCancel: (event) => endGesture(event, true),
    onClickCapture,
  };
}
