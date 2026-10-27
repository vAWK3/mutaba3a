import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreOperatorContract } from './store-contract-operator.js';

describeLedgerStoreOperatorContract('Memory', async () => new MemoryLedgerStore());
