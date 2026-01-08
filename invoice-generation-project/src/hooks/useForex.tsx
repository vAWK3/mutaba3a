import { useEffect, useState } from "react";
import { Currency } from "@/types";
import { formatTotal } from "../../utilities/formatters";

export function useForex(currency: Currency) {
  const [rate, setRate] = useState<number>();
  const [formattedRate, setFormattedRate] = useState<string>();

  useEffect(() => {
    const getExchangeRate = async () => {
      const host = "api.frankfurter.app";

      const fromCurrency = currency == Currency.Dollar ? "USD" : "ILS";
      const toCurrency = currency == Currency.Dollar ? "ILS" : "USD";

      const response = await fetch(
        `https://${host}/latest?amount=1&from=${fromCurrency}&to=${toCurrency}`
      );

      const data = await response.json();

      if (data) {
        const originCurrency =
          data.base == "USD" ? Currency.Dollar : Currency.Shekel;
        const convertedCurrency =
          data.base == "USD" ? Currency.Shekel : Currency.Dollar;

        const currentRate = `${formatTotal(
          data.amount,
          originCurrency
        )} = ${formatTotal(
          currency == Currency.Dollar ? data.rates.ILS : data.rates.USD,
          convertedCurrency
        )}`;
        setFormattedRate(currentRate);
        setRate(currency == Currency.Dollar ? data.rates.ILS : data.rates.USD);
      }
    };

    getExchangeRate();
  }, [currency]);

  return { rate, formattedRate };
}
