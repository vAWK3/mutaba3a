import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreContract } from './store-contract.js';

describeLedgerStoreContract('Memory', async () => new MemoryLedgerStore());
