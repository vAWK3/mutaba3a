import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreSignInCodesContract } from './store-contract-sign-in-codes.js';

describeLedgerStoreSignInCodesContract('Memory', async () => new MemoryLedgerStore());
