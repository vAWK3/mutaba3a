import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreUsersContract } from './store-contract-users.js';

describeLedgerStoreUsersContract('Memory', async () => new MemoryLedgerStore());
