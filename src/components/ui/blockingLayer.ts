/**
 * The page-wide state behind every open BlockingDialog (MUT-346 review). One layer for all of them, so they can
 * open and close in any order:
 *
 * - Every child of `<body>` except the newest dialog is `inert` and `aria-hidden`, including children that join
 *   `<body>` while a dialog is open (a MutationObserver). Each element's own values come back once the last
 *   dialog closes.
 * - The page doesn't scroll behind them: `<html>` gets `overflow: hidden`, keeping the scrollbar's room when it had
 *   one so nothing shifts.
 * - Where the browser has no `inert` (iOS before 15.5; jsdom), focus that lands behind the newest dialog is
 *   brought back to it. Taps can't land there anyway: the backdrop covers the page.
 */

export interface BlockingEntry {
  root: HTMLElement;
  panel: HTMLElement;
}

const stack: BlockingEntry[] = [];
const original = new Map<HTMLElement, { inert: string | null; ariaHidden: string | null }>();
let observer: MutationObserver | null = null;
let htmlBefore: { overflow: string; scrollbarGutter: string } | null = null;

const nativeInert = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;

export function openBlocking(entry: BlockingEntry): () => void {
  stack.push(entry);
  if (stack.length === 1) start();
  apply();
  return () => {
    const at = stack.indexOf(entry);
    if (at !== -1) stack.splice(at, 1);
    if (stack.length === 0) stop();
    else apply();
  };
}

/** The newest dialog is the reachable one. */
export function topBlocking(): BlockingEntry | undefined {
  return stack[stack.length - 1];
}

function start() {
  const html = document.documentElement;
  htmlBefore = { overflow: html.style.overflow, scrollbarGutter: html.style.scrollbarGutter };
  const hadScrollbar = window.innerWidth > html.clientWidth;
  html.style.overflow = 'hidden';
  if (hadScrollbar) html.style.scrollbarGutter = 'stable';
  observer = new MutationObserver(apply);
  observer.observe(document.body, { childList: true });
  if (!nativeInert) document.addEventListener('focusin', keepFocusOnTop, true);
}

function stop() {
  observer?.disconnect();
  observer = null;
  if (!nativeInert) document.removeEventListener('focusin', keepFocusOnTop, true);
  for (const [element, values] of original) {
    restore(element, 'inert', values.inert);
    restore(element, 'aria-hidden', values.ariaHidden);
  }
  original.clear();
  if (htmlBefore) {
    const html = document.documentElement;
    html.style.overflow = htmlBefore.overflow;
    html.style.scrollbarGutter = htmlBefore.scrollbarGutter;
    htmlBefore = null;
  }
}

/** Everything but the newest dialog is hidden; an older dialog that is now on top is given back. */
function apply() {
  const top = topBlocking();
  if (!top) return;
  for (const element of Array.from(document.body.children)) {
    if (!(element instanceof HTMLElement)) continue;
    if (element === top.root) {
      if (original.has(element)) give(element);
      continue;
    }
    if (!original.has(element)) original.set(element, { inert: element.getAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') });
    if (!element.hasAttribute('inert')) element.setAttribute('inert', '');
    if (element.getAttribute('aria-hidden') !== 'true') element.setAttribute('aria-hidden', 'true');
  }
}

function give(element: HTMLElement) {
  const values = original.get(element);
  if (!values) return;
  restore(element, 'inert', values.inert);
  restore(element, 'aria-hidden', values.ariaHidden);
}

function keepFocusOnTop(event: FocusEvent) {
  const top = topBlocking();
  if (top && event.target instanceof Node && !top.root.contains(event.target)) top.panel.focus({ preventScroll: true });
}

function restore(element: HTMLElement, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}
