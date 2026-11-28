import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreVatPeriodContract } from './store-contract-vat-periods.js';

describeLedgerStoreVatPeriodContract('Memory', async () => new MemoryLedgerStore());
