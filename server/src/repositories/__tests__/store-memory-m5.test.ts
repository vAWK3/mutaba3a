import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreM5Contract } from './store-contract-m5.js';

describeLedgerStoreM5Contract('Memory', async () => new MemoryLedgerStore());
