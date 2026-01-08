const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1);

export const getNameForLanguage = (name: string, language: string) =>
  `${name}${capitalize(language)}`;
