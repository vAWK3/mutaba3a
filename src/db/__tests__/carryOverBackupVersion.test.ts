import { describe, expect, it } from 'vitest';
import { db } from '../database';
import { FREE_APP_BACKUP_MAX_VERSION } from '../../hosted/local/carryOver/freeAppBackup';

/**
 * MUT-291: the new address refuses a free-app backup newer than the one it was
 * written for. A schema bump here without teaching the carry-over the new
 * version would turn every backup away, so the two move together.
 */
describe('the carry-over knows this schema version', () => {
  it('FREE_APP_BACKUP_MAX_VERSION is the free app\'s own', () => {
    expect(FREE_APP_BACKUP_MAX_VERSION).toBe(db.verno);
  });
});
