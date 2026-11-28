import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStorePushDevicesContract } from './store-contract-push-devices.js';

describeLedgerStorePushDevicesContract('Memory', async () => new MemoryLedgerStore());
