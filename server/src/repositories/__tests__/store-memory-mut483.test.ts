import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreMut483Contract } from './store-contract-mut483.js';

describeLedgerStoreMut483Contract('Memory', async () => new MemoryLedgerStore());
