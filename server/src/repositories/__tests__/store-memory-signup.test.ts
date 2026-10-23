import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreSignupContract } from './store-contract-signup.js';

describeLedgerStoreSignupContract('Memory', async () => new MemoryLedgerStore());
