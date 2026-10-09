import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreM4Contract } from './store-contract-m4.js';

describeLedgerStoreM4Contract('Memory', async () => new MemoryLedgerStore());
