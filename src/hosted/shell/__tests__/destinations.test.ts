import { describe, expect, it } from 'vitest';
import { DESTINATIONS, NO_DESTINATION, destinationOf, destinationPath } from '../destinations';

const P = '11111111-1111-4111-8111-111111111111';

/**
 * MUT-424 (E2): which destination a portal path belongs to. MUT-657 (E-1/E-2): home takes the bare profile path and
 * is the pill's first item; Owed's overview moved to `/owed`.
 */
describe('destinationOf', () => {
  it.each([
    [`/p/${P}`, 'home'],
    [`/p/${P}/`, 'home'],
    [`/p/${P}?view=in-out`, 'home'],
    [`/p/${P}/owed`, 'owed'],
    [`/p/${P}/owed?currency=USD`, 'owed'],
    [`/p/${P}/receivables`, 'owed'],
    [`/p/${P}/receivables?status=OPEN`, 'owed'],
    [`/p/${P}/payments`, 'paid'],
    [`/p/${P}/conversions`, 'paid'],
    [`/p/${P}/expenses`, 'spent'],
    [`/p/${P}/expenses/groups`, 'spent'],
    [`/p/${P}/expenses/groups/g1`, 'spent'],
    [`/p/${P}/clients`, 'clients'],
    [`/p/${P}/clients/c1?tab=documents`, 'clients'],
    [`/p/${P}/documents`, 'clients'],
  ])('%s is %s', (path, destination) => {
    expect(destinationOf(path)).toBe(destination);
  });

  it.each([`/p/${P}/reports`, `/p/${P}/you`, `/p/${P}/you/account`, '/you', '/sign-in', '/', `/p/${P}/unknown`])('%s lights no destination', (path) => {
    expect(destinationOf(path)).toBeNull();
  });

  it('keeps Reports and the You page as deliberate exceptions (R2: Reports opens from its own icon)', () => {
    expect([...NO_DESTINATION].sort()).toEqual(['reports', 'you']);
  });

  it('lists home first, then the four destinations, in the pill order', () => {
    expect(DESTINATIONS.map((d) => d.key)).toEqual(['home', 'owed', 'paid', 'spent', 'clients']);
    expect(DESTINATIONS.map((d) => destinationPath(P, d.key))).toEqual([`/p/${P}`, `/p/${P}/owed`, `/p/${P}/payments`, `/p/${P}/expenses`, `/p/${P}/clients`]);
  });
});
