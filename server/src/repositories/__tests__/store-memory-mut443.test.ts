import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreMut443Contract } from './store-contract-mut443.js';

describeLedgerStoreMut443Contract('Memory', async () => new MemoryLedgerStore());
