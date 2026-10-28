import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreMut479Contract } from './store-contract-mut479.js';

describeLedgerStoreMut479Contract('Memory', async () => new MemoryLedgerStore());
