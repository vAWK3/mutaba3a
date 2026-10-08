import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreM3Contract } from './store-contract-m3.js';

describeLedgerStoreM3Contract('Memory', async () => new MemoryLedgerStore());
