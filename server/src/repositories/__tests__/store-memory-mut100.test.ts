import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreMut100Contract } from './store-contract-mut100.js';

describeLedgerStoreMut100Contract('Memory', async () => new MemoryLedgerStore());
