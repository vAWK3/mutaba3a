import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreChangePasswordContract } from './store-contract-change-password.js';

describeLedgerStoreChangePasswordContract('Memory', async () => new MemoryLedgerStore());
