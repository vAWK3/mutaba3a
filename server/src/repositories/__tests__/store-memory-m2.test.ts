import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreM2Contract } from './store-contract-m2.js';

describeLedgerStoreM2Contract('Memory', async () => new MemoryLedgerStore());
