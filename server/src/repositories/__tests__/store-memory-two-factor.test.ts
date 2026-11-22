import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreTwoFactorContract } from './store-contract-two-factor.js';

describeLedgerStoreTwoFactorContract('Memory', async () => new MemoryLedgerStore());
