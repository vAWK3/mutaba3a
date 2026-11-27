import { IL_FIXTURE } from './il.js';
import type { PackFixture } from './types.js';

export type { GoldenCase, PackExpectations, PackFixture, PackGolden, PackRouteFixture } from './types.js';

/** MUT-745: one fixture per registered pack, by country. A new pack adds its fixture here (the contract suite asks). */
export const PACK_FIXTURES: Readonly<Record<string, PackFixture>> = {
  IL: IL_FIXTURE,
};
