export enum AnalyticsPeriod {
  Days30 = "30D",
  Months6 = "6M",
  YTD = "YTD",
  Year1 = "1Y",
}

const translations = {
  en: {
    [AnalyticsPeriod.Days30]: "30D",
    [AnalyticsPeriod.Months6]: "6M",
    [AnalyticsPeriod.YTD]: "YTD",
    [AnalyticsPeriod.Year1]: "1Y",
  },
  ar: {
    [AnalyticsPeriod.Days30]: "30ي",
    [AnalyticsPeriod.Months6]: "6ش",
    [AnalyticsPeriod.YTD]: "أول السنة",
    [AnalyticsPeriod.Year1]: "1س",
  },
};

export function translateEnumValue(
  value: AnalyticsPeriod,
  locale: keyof typeof translations
): string {
  return translations[locale][value] || value;
}
