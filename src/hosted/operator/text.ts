/** An address isolated in a sentence (FSI … PDI), so it reads left to right and never reorders an Arabic line. */
export const isolated = (email: string) => `⁨${email}⁩`;
