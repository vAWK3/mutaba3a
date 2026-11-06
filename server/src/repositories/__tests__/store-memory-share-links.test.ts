import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreShareLinksContract } from './store-contract-share-links.js';

describeLedgerStoreShareLinksContract('Memory', async () => new MemoryLedgerStore());
