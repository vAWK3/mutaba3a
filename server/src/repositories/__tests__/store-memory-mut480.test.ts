import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreMut480Contract } from './store-contract-mut480.js';

describeLedgerStoreMut480Contract('Memory', async () => new MemoryLedgerStore());
