import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreEmailContract } from './store-contract-email.js';

describeLedgerStoreEmailContract('Memory', async () => new MemoryLedgerStore());
