import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreIssuingContract } from './store-contract-issuing.js';

describeLedgerStoreIssuingContract('Memory', async () => new MemoryLedgerStore());
