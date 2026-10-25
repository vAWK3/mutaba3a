import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreFeaturesContract } from './store-contract-features.js';

describeLedgerStoreFeaturesContract('Memory', async () => new MemoryLedgerStore());
