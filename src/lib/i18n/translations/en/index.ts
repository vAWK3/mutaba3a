/**
 * The app's English dictionary, one JSON file per feature (MUT-24). Each file
 * holds whole top-level namespaces, so key paths did not change with the split.
 * A new file goes in PARTS; translations.test.ts fails on a file left out or on
 * en and ar files that hold different namespaces.
 */
import { composeDictionary } from '../compose';
import common from './common.json';
import transactions from './transactions.json';
import clients from './clients.json';
import drawer from './drawer.json';
import landing from './landing.json';

export const PARTS = {
  common,
  transactions,
  clients,
  drawer,
  landing,
};

const en = composeDictionary(PARTS);

export default en;
