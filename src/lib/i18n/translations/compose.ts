type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;

/** One dictionary typed as every part's namespaces together. */
export type Composed<P> = UnionToIntersection<P[keyof P]>;

/**
 * Joins a language's per-feature files into one dictionary (MUT-24). Each file
 * holds whole top-level namespaces; a namespace in two files would silently lose
 * one of them, so that throws instead.
 */
export function composeDictionary<P extends Record<string, object>>(parts: P): Composed<P> {
  const dictionary: Record<string, unknown> = {};
  const owner: Record<string, string> = {};
  for (const [file, part] of Object.entries(parts)) {
    for (const [namespace, value] of Object.entries(part)) {
      if (namespace in owner) {
        throw new Error(`Namespace "${namespace}" is defined in both ${owner[namespace]}.json and ${file}.json`);
      }
      owner[namespace] = file;
      dictionary[namespace] = value;
    }
  }
  return dictionary as Composed<P>;
}
