import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreAccountantProvisionContract } from './store-contract-accountant-provision.js';

describeLedgerStoreAccountantProvisionContract('Memory', async () => new MemoryLedgerStore());
