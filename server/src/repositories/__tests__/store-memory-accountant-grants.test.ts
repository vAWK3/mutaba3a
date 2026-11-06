import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreAccountantGrantsContract } from './store-contract-accountant-grants.js';

describeLedgerStoreAccountantGrantsContract('Memory', async () => new MemoryLedgerStore());
