/**
 * MUT-741 (ADR-287): the jurisdiction packs' one door. Core code reaches a country's rules only through this module;
 * `jurisdictions/il/**` is imported directly by nothing else except the files named in `boundary.test.ts` (Israel-only
 * endpoints and stores that model Israel's database rules), and that list only shrinks.
 */
export type { ComposePack, DatedTable, JurisdictionPack } from './pack.js';
export { assertPacksFor, defaultPack, hasPack, packFor, registeredCountries, registerPackForTests } from './registry.js';
export { HttpTaxAuthorityClient } from './il/tax-authority/client.js';
export { TokenBox } from './il/tax-authority/token-box.js';
export { RegistryLookup } from './il/registry.js';
export type { UniformFile, UniformFileHouse } from './il/uniform-file/export.js';
export type { TaxAuthorityDeps } from './il/tax-authority/service.js';
