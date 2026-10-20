import { describe, expect, it } from 'vitest';
import { AsyncLocalStorage } from '../platform/async-hooks';

/** The browser stand-in for node:async_hooks (MUT-286): single-slot save/restore, never throws on import. */
describe('AsyncLocalStorage shim', () => {
  it('has no store outside run, matching the "no context" shape tryGetContext handles', () => {
    expect(new AsyncLocalStorage<string>().getStore()).toBeUndefined();
  });

  it('exposes the store inside run and restores the outer one after, nested or not', () => {
    const storage = new AsyncLocalStorage<string>();
    const seen = storage.run('outer', () => [storage.getStore(), storage.run('inner', () => storage.getStore()), storage.getStore()]);
    expect(seen).toEqual(['outer', 'inner', 'outer']);
    expect(storage.getStore()).toBeUndefined();
  });

  it('restores the outer store even when the callback throws', () => {
    const storage = new AsyncLocalStorage<string>();
    storage.run('outer', () => {
      expect(() =>
        storage.run('inner', () => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(storage.getStore()).toBe('outer');
    });
  });

  it('clears the store inside exit and puts it back after', () => {
    const storage = new AsyncLocalStorage<string>();
    storage.enterWith('entered');
    expect(storage.exit(() => storage.getStore())).toBeUndefined();
    expect(storage.getStore()).toBe('entered');
  });

  it('drops the store on disable', () => {
    const storage = new AsyncLocalStorage<string>();
    storage.enterWith('entered');
    storage.disable();
    expect(storage.getStore()).toBeUndefined();
  });
});
