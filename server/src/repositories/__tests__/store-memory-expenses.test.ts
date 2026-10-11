import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreExpensesContract } from './store-contract-expenses.js';

describeLedgerStoreExpensesContract('Memory', async () => new MemoryLedgerStore());
