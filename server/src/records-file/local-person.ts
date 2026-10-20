/**
 * The one person on a device in the portal's local mode (MUT-286): never
 * shown, it exists only so the local person is an ordinary row `findByEmail`
 * can find again on the next boot. Shared with the hosted export (MUT-325),
 * which writes the exporter under this address so a restored file boots as
 * that device's person.
 */
export const LOCAL_PERSON_EMAIL = 'local@device.invalid';
