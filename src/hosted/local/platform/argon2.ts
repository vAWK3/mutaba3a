/**
 * Browser substitute for `@node-rs/argon2` in the portal build. Local mode (MUT-286) runs the server's own routes in
 * the page, so `server/src/app.ts` comes along with `createArgon2Hasher` and its import of `@node-rs/argon2`. Nothing
 * local ever hashes a password: sign-in, setup links and signup always go to the server (client.ts ALWAYS_REMOTE), and
 * the local person signs in by minting a local session, not by password. Without this alias the build has to resolve
 * the package's `browser` entry, which needs an optional WASM package npm never installs on macOS or Linux, and the
 * hosted build fails (found during MUT-368). Calling either function here is a bug, so each throws.
 */
const UNAVAILABLE = 'argon2 is not available in the browser: password hashing happens on the server only';

export async function hash(): Promise<string> {
  throw new Error(UNAVAILABLE);
}

export async function verify(): Promise<boolean> {
  throw new Error(UNAVAILABLE);
}
