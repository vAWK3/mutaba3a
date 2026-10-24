const INITIALS = 2;

/** The avatar's letters: the first letter of the first two words of a name (MUT-425: moved out of the account menu). */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, INITIALS)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
