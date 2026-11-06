/* eslint-disable react-refresh/only-export-components */
import { SCENE_ART, type SceneArtName } from '../../components/illustrations/generated';

/**
 * MUT-561 (D10): a brand scene (MUT-345, drawn in Claude Design) on a portal page: an empty state, a done pane. The art
 * is generated from `assets/illustrations/source/` (`npm run illustrations:generate`) and painted with the brand
 * tokens, so dark mode needs no second drawing. It is decoration: the copy beside it carries the meaning.
 *
 * A scene a plan names before Claude Design has drawn it (MUT-558's brief) renders the empty-state art as its
 * placeholder, and swaps on its own once its SVG lands and the generator reruns. Nothing mirrors in RTL: the art is
 * drawn with no reading direction.
 */

/** The MUT-558 scenes on order from Claude Design (`claude-design-brief.md`); each is a placeholder until drawn. */
type PlannedScene = 'accountant-empty' | 'link-ready' | 'shared-books' | 'link-closed' | 'client-books-empty' | 'share-ended';
export type SceneName = SceneArtName | PlannedScene;

export const PLACEHOLDER_SCENE: SceneArtName = 'empty-state';

/** `drop-in`: the empty states' one-shot (minimal tier, under a second): the nuqta drops onto the art. */
export type SceneMotion = 'drop-in' | 'none';

const DEFAULT_SIZE = 160;

function isDrawn(name: string): name is SceneArtName {
  return Object.hasOwn(SCENE_ART, name);
}

/** The art a scene shows: its own once drawn, the placeholder until then. */
export function sceneArtFor(name: SceneName): { name: SceneArtName; placeholder: boolean } {
  return isDrawn(name) ? { name, placeholder: false } : { name: PLACEHOLDER_SCENE, placeholder: true };
}

export function Scene({ name, size = DEFAULT_SIZE, motion = 'none', className }: { name: SceneName; size?: number; motion?: SceneMotion; className?: string }) {
  const art = sceneArtFor(name);
  const Art = SCENE_ART[art.name];
  const classes = ['hp-scene', motion === 'drop-in' ? 'hp-scene--drop-in' : null, className].filter(Boolean).join(' ');
  return (
    <span className={classes} aria-hidden="true" data-scene={name} data-scene-art={art.name} data-placeholder={art.placeholder || undefined}>
      <Art size={size} />
    </span>
  );
}
