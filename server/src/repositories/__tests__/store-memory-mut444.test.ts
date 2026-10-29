import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreMut444Contract } from './store-contract-mut444.js';

describeLedgerStoreMut444Contract('Memory', async () => new MemoryLedgerStore());
