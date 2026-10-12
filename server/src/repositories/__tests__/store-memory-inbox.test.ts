import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreInboxContract } from './store-contract-inbox.js';

describeLedgerStoreInboxContract('Memory', async () => new MemoryLedgerStore());
