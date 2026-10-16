/**
 * The app's Arabic dictionary, one JSON file per feature (MUT-24). Each file
 * holds whole top-level namespaces, so key paths did not change with the split.
 * A new file goes in PARTS; translations.test.ts fails on a file left out or on
 * en and ar files that hold different namespaces.
 */
import { composeDictionary } from '../compose';
import common from './common.json';
import shell from './shell.json';
import overview from './overview.json';
import transactions from './transactions.json';
import income from './income.json';
import expenses from './expenses.json';
import conversions from './conversions.json';
import projects from './projects.json';
import clients from './clients.json';
import insights from './insights.json';
import reports from './reports.json';
import settings from './settings.json';
import drawer from './drawer.json';
import fx from './fx.json';
import integrity from './integrity.json';
import demo from './demo.json';
import download from './download.json';
import landing from './landing.json';

export const PARTS = {
  common,
  shell,
  overview,
  transactions,
  income,
  expenses,
  conversions,
  projects,
  clients,
  insights,
  reports,
  settings,
  drawer,
  fx,
  integrity,
  demo,
  download,
  landing,
};

const ar = composeDictionary(PARTS);

export default ar;
