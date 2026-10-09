import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreM7Contract } from './store-contract-m7.js';

describeLedgerStoreM7Contract('Memory', async () => new MemoryLedgerStore());
