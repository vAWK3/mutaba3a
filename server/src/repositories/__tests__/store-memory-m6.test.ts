import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreM6Contract } from './store-contract-m6.js';

describeLedgerStoreM6Contract('Memory', async () => new MemoryLedgerStore());
