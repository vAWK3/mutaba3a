export const atLeastOneTranslationProvided = (translations: string[]) => {
    return translations.some((value) => value && value.trim() !== "");
  };