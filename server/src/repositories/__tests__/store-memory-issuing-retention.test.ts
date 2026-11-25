import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreIssuingRetentionContract } from './store-contract-issuing-retention.js';

describeLedgerStoreIssuingRetentionContract('Memory', async () => new MemoryLedgerStore());
