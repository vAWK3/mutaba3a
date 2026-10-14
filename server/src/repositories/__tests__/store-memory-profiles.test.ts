import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreProfilesContract } from './store-contract-profiles.js';

describeLedgerStoreProfilesContract('Memory', async () => new MemoryLedgerStore());
