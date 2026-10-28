import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreReceiptReadingContract } from './store-contract-receipt-reading.js';

describeLedgerStoreReceiptReadingContract('Memory', async () => new MemoryLedgerStore());
