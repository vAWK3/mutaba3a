/* eslint-disable react-refresh/only-export-components */
import { SCENE_ART, type SceneArtName } from '../../components/illustrations/generated';
import { useOptionalDirection } from '../../lib/i18n/core';
import type { Direction } from '../../lib/i18n/types';

/**
 * MUT-561 (D10): a brand scene (MUT-345, drawn in Claude Design) on a portal page: an empty state, a done pane. The art
 * is generated from `assets/illustrations/source/` (`npm run illustrations:generate`) and painted with the brand
 * tokens, so dark mode needs no second drawing. It is decoration: the copy beside it carries the meaning.
 *
 * A scene a plan names before Claude Design has drawn it (MUT-558's brief) renders the empty-state art as its
 * placeholder, and swaps on its own once its SVG lands and the generator reruns.
 *
 * Direction (2026-11-27): a scene with a reading direction ships a second drawing, `<name>-rtl`. In an RTL document
 * `Scene` shows that drawing when it exists and the plain one otherwise. Nothing is ever mirrored with CSS.
 */

const RTL_SUFFIX = '-rtl';

/** A drawn scene's name: every generated art except the `-rtl` drawings, which `Scene` picks on its own. */
type DrawnScene = Exclude<SceneArtName, `${string}${typeof RTL_SUFFIX}`>;

/**
 * Scenes a plan has ordered from Claude Design but not received yet; each renders the placeholder until drawn. Empty
 * today: MUT-558's six scenes landed (b2a02e37). Add a name here when a plan orders one.
 */
type PlannedScene = never;
export type SceneName = DrawnScene | PlannedScene;

/** Every drawn scene a page can name (no `-rtl` drawings). */
export const SCENE_NAMES: readonly DrawnScene[] = (Object.keys(SCENE_ART) as SceneArtName[]).filter(
  (name): name is DrawnScene => !name.endsWith(RTL_SUFFIX),
);

export const PLACEHOLDER_SCENE: SceneArtName = 'empty-state';

/**
 * `drop-in`: the empty states' one-shot (minimal tier, under a second): the nuqta drops onto the art.
 * `plan-upgraded` (MUT-734) and `gift-month` (MUT-733): the 2026-11-27 moments, each built in CSS from its spec in
 * `docs/design/motion/2026-11-27/<moment>/`; they play once on mount and reduced motion shows the still (the art).
 */
export type SceneMotion = 'drop-in' | 'plan-upgraded' | 'gift-month' | 'none';

function isDrawn(name: string): name is SceneArtName {
  return Object.hasOwn(SCENE_ART, name);
}

/** The art a scene shows: its own once drawn (its `-rtl` drawing in RTL when there is one), the placeholder until then. */
export function sceneArtFor(name: SceneName, direction: Direction = 'ltr'): { name: SceneArtName; placeholder: boolean } {
  if (!isDrawn(name)) return { name: PLACEHOLDER_SCENE, placeholder: true };
  const rtlArt = `${name}${RTL_SUFFIX}`;
  if (direction === 'rtl' && isDrawn(rtlArt)) return { name: rtlArt, placeholder: false };
  return { name, placeholder: false };
}

/**
 * `size` is the width in px; the height keeps the art's aspect ratio (160x160 scenes stay square, 120x96 ones stay
 * 5:4). Without it the art shows at its drawn size.
 */
export function Scene({ name, size, motion = 'none', className }: { name: SceneName; size?: number; motion?: SceneMotion; className?: string }) {
  const art = sceneArtFor(name, useOptionalDirection());
  const Art = SCENE_ART[art.name];
  const classes = ['hp-scene', motion === 'none' ? null : `hp-scene--${motion}`, className].filter(Boolean).join(' ');
  return (
    <span className={classes} aria-hidden="true" data-scene={name} data-scene-art={art.name} data-placeholder={art.placeholder || undefined}>
      <Art size={size} />
    </span>
  );
}
