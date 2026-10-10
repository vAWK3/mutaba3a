import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreM8Contract } from './store-contract-m8.js';

describeLedgerStoreM8Contract('Memory', async () => new MemoryLedgerStore());
