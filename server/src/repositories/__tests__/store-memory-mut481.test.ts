import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreMut481Contract } from './store-contract-mut481.js';

describeLedgerStoreMut481Contract('Memory', async () => new MemoryLedgerStore());
