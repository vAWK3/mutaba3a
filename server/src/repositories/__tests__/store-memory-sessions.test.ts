import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreSessionsContract } from './store-contract-sessions.js';

describeLedgerStoreSessionsContract('Memory', async () => new MemoryLedgerStore());
