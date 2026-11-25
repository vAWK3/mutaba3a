/**
 * MUT-593 (ADR-254): the OpenAPI `security` a route declares to say who may call it. A person signed in to the portal
 * or the phone; and, for a route Malafat may call as that person, `delegated` too (default refuse: a route that
 * doesn't list it is closed to Malafat's token, and the published contract is the list).
 */
export const PERSON = [{ session: [] }, { deviceSession: [] }];

export const PERSON_OR_MALAFAT = [{ session: [] }, { deviceSession: [] }, { delegated: [] }];
