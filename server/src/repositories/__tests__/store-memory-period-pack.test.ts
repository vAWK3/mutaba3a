import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStorePeriodPackContract } from './store-contract-period-pack.js';

describeLedgerStorePeriodPackContract('Memory', async () => new MemoryLedgerStore());
