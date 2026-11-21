/**
 * MUT-568: the issuing core is versioned on its own and stamped on every issued document. Bump it only when a rule in
 * `server/src/issuing/` changes (numbering, math, immutability, document types): this is the version the Tax
 * Authority registration (MUT-567) refers to, so unrelated releases of the API never change it.
 */
export const ISSUING_CORE_VERSION = '1.0.0';
