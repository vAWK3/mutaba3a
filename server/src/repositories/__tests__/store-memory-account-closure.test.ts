import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreAccountClosureContract } from './store-contract-account-closure.js';

describeLedgerStoreAccountClosureContract('Memory', async () => new MemoryLedgerStore());
