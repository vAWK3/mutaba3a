import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreBillingContract } from './store-contract-billing.js';

describeLedgerStoreBillingContract('Memory', async () => new MemoryLedgerStore());
