"use client";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import {
  TextInput,
  Select,
  GridProps,
  Text,
  Menu,
  MenuDropdown,
  MenuItem,
  MenuTarget,
  NumberInput,
} from "@mantine/core";

import { useTranslations } from "next-intl";
import { Currency, DocumentData } from "@/types";
import { useForex } from "@/hooks/useForex";
import { useState } from "react";
import { parseStringToNumber } from "../../../../utilities/formatters";

interface DocSettingsProps extends GridProps {
  // form: UseFormReturnType<DocumentData>;
  document: DocumentData;
  onUpdateDocument: (document: DocumentData) => void;
}

const DocSettings = ({
  document,
  onUpdateDocument,
  ...props
}: DocSettingsProps) => {
  const t = useTranslations("Documents");

  const initialCurrency =
    document.settings.currency == Currency.Dollar ? "Dollar" : "Shekel";

  const [currency, setCurrency] = useState<string>(initialCurrency);
  const { rate, formattedRate } = useForex(
    Currency[currency as keyof typeof Currency] ?? Currency.Dollar
  );
  const [discountType, setDiscountType] = useState<string>("percentage");
  const [discount, setDiscount] = useState<number>(0);

  return (
    <ResponsiveGrid desktopSpan={[6, 6]} mobileSpan={[12]} {...props}>
      <Select
        label={t("currency")}
        allowDeselect={false}
        onChange={(value) => {
          if (value) {
            const c = Currency[value as keyof typeof Currency];
            setCurrency(value!);
            onUpdateDocument({
              ...document,
              settings: { ...document.settings, currency: c },
            });
          }
          // form.setFieldValue("settings.currency", c);
        }}
        value={currency}
        // error={form.getInputProps("settings.currency").error}
        data={Object.keys(Currency).map((item) => ({
          value: item,
          label: item,
        }))}
      />
      <TextInput
        label={t("exchange_rate")}
        disabled
        placeholder={t("exchange_rate_shkl")}
        value={formattedRate ?? "-"}
      />
      <NumberInput
        label={t("discount")}
        max={discountType == "fix" ? document.subtotal : 100}
        value={document?.settings?.discount}
        // value={discount
        onChange={(value) => {
          // const subtotal = form.getValues().subtotal;

          const subtotal = document.subtotal;

          if (typeof value === "string") {
            value = parseStringToNumber(value) ?? 0;
          }

          if (discountType == "fix") {
            if (value > subtotal) {
              value = subtotal;
            }
          } else {
            if (value > 100) {
              value = subtotal;
            } else {
              value = (value / 100) * subtotal;
            }
          }

          setDiscount(value);
          onUpdateDocument({ ...document, discount: value });
        }}
        rightSectionWidth={36}
        rightSection={
          <Menu>
            <MenuTarget>
              <Text ff={"monospace"}>
                {discountType == "percentage" ? "%" : currency}
              </Text>
            </MenuTarget>
            <MenuDropdown>
              <MenuItem
                onClick={() => {
                  setDiscountType("percentage");
                  if (discount > 100) {
                    setDiscount(100);
                    onUpdateDocument({
                      ...document,
                      discount: document.subtotal,
                    });
                  } else {
                    onUpdateDocument({
                      ...document,
                      discount: (discount / 100) * document.subtotal,
                    });
                  }
                }}
              >
                %
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setDiscountType("fix");
                  const subtotal = document.subtotal;
                  if (discount > subtotal) {
                    setDiscount(subtotal);
                    onUpdateDocument({
                      ...document,
                      discount: subtotal,
                    });
                  } else {
                    onUpdateDocument({
                      ...document,
                      discount: discount,
                    });
                  }
                }}
              >
                {currency}
              </MenuItem>
            </MenuDropdown>
          </Menu>
        }
        hideControls
      />
      <TextInput
        label={t("tax")}
        disabled
        value={17}
        rightSection={<Text ff={"monospace"}>%</Text>}
      />
    </ResponsiveGrid>
  );
};

export default DocSettings;
