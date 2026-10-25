import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStorePasskeysContract } from './store-contract-passkeys.js';

describeLedgerStorePasskeysContract('Memory', async () => new MemoryLedgerStore());
