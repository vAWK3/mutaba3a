import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreOAuthContract } from './store-contract-oauth.js';

describeLedgerStoreOAuthContract('Memory', async () => new MemoryLedgerStore());
