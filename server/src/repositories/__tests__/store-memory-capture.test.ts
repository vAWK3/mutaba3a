import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreCaptureContract } from './store-contract-capture.js';

describeLedgerStoreCaptureContract('Memory', async () => new MemoryLedgerStore());
