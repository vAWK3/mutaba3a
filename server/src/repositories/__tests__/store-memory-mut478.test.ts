import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreMut478Contract } from './store-contract-mut478.js';

describeLedgerStoreMut478Contract('Memory', async () => new MemoryLedgerStore());
