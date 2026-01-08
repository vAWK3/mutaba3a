import { Currency } from "@/types";
import { Select } from "@mantine/core";
import { useTranslations } from "next-intl";

const CurrencySelector = ({ label }: { label: string }) => {
  const t = useTranslations("Currency");

  return (
    <Select
      label={label}
      checkIconPosition="right"
      defaultValue={Object.keys(Currency).filter((item) => item == item)[0]}
      onChange={(value) => {
        // setCurrency(Currency[value as keyof typeof Currency]);
      }}
      data={Object.keys(Currency).map((item) => ({
        value: item,
        label: `${Currency[item as keyof typeof Currency]} ${t(`${item}`)}`,
      }))}
    />
  );
};

export default CurrencySelector;
