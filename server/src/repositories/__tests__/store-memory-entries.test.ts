import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreEntriesContract } from './store-contract-entries.js';

describeLedgerStoreEntriesContract('Memory', async () => new MemoryLedgerStore());
