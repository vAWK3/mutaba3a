"use client";

import { Text, NumberInput, Select } from "@mantine/core";
import { useTranslations } from "next-intl";
import {
  ClientData,
  Currency,
  Language,
  PaymentTerms,
} from "@/types";
import CustomFormInput from "@/components/form/customFormInput";
import { UseFormReturnType } from "@mantine/form";
import { IconPercentage } from "@tabler/icons-react";
import { fontAr, fontEn } from "../../fonts";
import { useState } from "react";

interface ClientDocumentFormData {
  form: UseFormReturnType<ClientData>;
}

const ClientDocumentForm = ({ form }: ClientDocumentFormData) => {
  const t = useTranslations("Clients");
  const tc = useTranslations("Currency");

  //TODO: update defaults to be from profile settings
  const [currency, setCurrency] = useState<Currency>(Currency['Shekel' as keyof typeof Currency]);
  const [language, setLanguage] = useState<Language>(form.getValues().document?.language ?? Language.en);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(form.getValues().document?.payment ?? PaymentTerms.IMMEDIATE);

  return (
    <CustomFormInput width={"100%"} title={t("document_details")}>
      <Select
        label={t("payment_terms")}
        error={form.getInputProps("document.payment").error}
        value={paymentTerms}
        allowDeselect={false}
        onChange={(value) => {
          if (!value) {
            return;
          }
          form.setFieldValue('document.payment', value);
          setPaymentTerms(PaymentTerms[value as keyof typeof PaymentTerms]);
        }}
        data={Object.keys(PaymentTerms).map((key) => {
          return {
            value: PaymentTerms[key as keyof typeof PaymentTerms],
            label: t(`${key.toLowerCase()}`),
          };
        })}
      />
      <Select
        label={t("default_currency")}
        withAsterisk
        allowDeselect={false}
        // {...form.getInputProps("document.currency")}
        error={form.getInputProps("document.currency").error}
        value={currency}
        onChange={(value) => {
          console.log('value is ', value);
          if (!value) {
            return;
          }
          console.log('logging on change currency is now ', value);
          form.setFieldValue('document.currency', value);
          setCurrency(Currency[value as keyof typeof Currency]);
        }}
        data={Object.keys(Currency).map((key) => {
          return {
            value: Currency[key as keyof typeof Currency],
            label: `${Currency[key as keyof typeof Currency]} - ${tc(
              `${key}`
            )}`,
          };
        })}
      />
      <Select
        label={t("default_language")}
        withAsterisk
        allowDeselect={false}
        error={form.getInputProps("document.language").error}
        value={language}
        onChange={(value) => {
          if (!value) {
            return;
          }

          form.setFieldValue('document.language', value);
          setLanguage(Language[value as keyof typeof Language]);
        }}
        renderOption={(item) => (
          <Text
            className={

              item.option.value ==
                Language.ar
                ? fontAr.className
                : fontEn.className
            }
          >
            {item.option.label}
          </Text>
        )}
        data={Object.keys(Language).map((key) => {
          return {
            value: Language[key as keyof typeof Language],
            label: Language[key as keyof typeof Language],
          };
        })}
      />
      <NumberInput
        label={t("default_discount")}
        {...form.getInputProps("document.discount")}
        rightSection={<IconPercentage />}
        styles={{
          input: {
            fontFamily: "monospace",
          },
        }}
      />
    </CustomFormInput>
  );
};

export default ClientDocumentForm;
