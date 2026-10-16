import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreAccountSetupContract } from './store-contract-account-setup.js';

describeLedgerStoreAccountSetupContract('Memory', async () => new MemoryLedgerStore());
