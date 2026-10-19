import { MemoryLedgerStore } from '../memory.js';
import { describeLedgerStoreExpenseGroupsContract } from './store-contract-expense-groups.js';

describeLedgerStoreExpenseGroupsContract('Memory', async () => new MemoryLedgerStore());
