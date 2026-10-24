import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreVendorsContract } from './store-contract-vendors.js';

describeLedgerStoreVendorsContract('Memory', async () => new MemoryLedgerStore());
