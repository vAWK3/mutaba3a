import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreAgentLockContract } from './store-contract-agent-lock.js';

describeLedgerStoreAgentLockContract('Memory', async () => new MemoryLedgerStore());
