import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreUsageContract } from './store-contract-usage.js';

describeLedgerStoreUsageContract('Memory', async () => new MemoryLedgerStore());
