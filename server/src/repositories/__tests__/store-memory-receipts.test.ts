import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreReceiptsContract } from './store-contract-receipts.js';

describeLedgerStoreReceiptsContract('Memory', async () => new MemoryLedgerStore(), { concurrent: false });
