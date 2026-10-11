import type { TypeaheadOption } from './EntityTypeahead';

/**
 * The option Enter would pick for typed text: the first existing option whose
 * label starts with it, else the create option, else the only option of a
 * select-only list. Never a mere substring match, so typing a new "Ann" while
 * "Joanna" exists offers to create Ann rather than picking Joanna.
 */
export function defaultAutoHighlight<T>(options: TypeaheadOption<T>[], typed: string): number {
  const query = typed.trim().toLowerCase();
  if (!query) return -1;
  const prefix = options.findIndex((o) => !o.isNew && o.label.toLowerCase().startsWith(query));
  if (prefix >= 0) return prefix;
  const create = options.findIndex((o) => o.isNew);
  if (create >= 0) return create;
  return options.length === 1 ? 0 : -1;
}
