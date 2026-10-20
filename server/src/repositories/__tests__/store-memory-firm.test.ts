import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreFirmContract } from './store-contract-firm.js';

describeLedgerStoreFirmContract('Memory', async () => new MemoryLedgerStore());
