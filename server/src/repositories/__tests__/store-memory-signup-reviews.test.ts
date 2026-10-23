import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreSignupReviewContract } from './store-contract-signup-reviews.js';

describeLedgerStoreSignupReviewContract('Memory', async () => new MemoryLedgerStore());
