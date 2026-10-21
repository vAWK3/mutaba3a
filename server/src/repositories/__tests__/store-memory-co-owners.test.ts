import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreCoOwnersContract } from './store-contract-co-owners.js';

describeLedgerStoreCoOwnersContract('Memory', async () => new MemoryLedgerStore());
