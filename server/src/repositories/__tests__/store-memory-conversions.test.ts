import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreConversionsContract } from './store-contract-conversions.js';

describeLedgerStoreConversionsContract('Memory', async () => new MemoryLedgerStore());
