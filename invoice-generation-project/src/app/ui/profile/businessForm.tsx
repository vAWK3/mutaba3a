"use client";

import { useState } from "react";
import { Select, Button, Title, Box } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { TaxForm } from "./taxForm";
import BasicInfoForm from "./BasicInfoForm";
import { BusinessType, MultilingualFormData, ProfileData } from "@/types";
import ProfileInput from "./input";
import { UseFormReturnType } from "@mantine/form";

interface BusinessFormProps {
  title: string[];
  form: UseFormReturnType<MultilingualFormData<ProfileData>>;
  initialType?: BusinessType;
}

const BusinessForm = ({ title, form, initialType }: BusinessFormProps) => {
  const t = useTranslations("Profile");
  const tb = useTranslations("Buttons");
  const [businessType, setBusinessType] = useState<string | null>(
    initialType ?? null
  );

  return (
    <Box w={"100%"}>
      <Title order={2} ta={"center"}>
        {title[0]}
      </Title>
      <Title order={2} mb={"xl"} ta={"center"}>
        {title[1]}
      </Title>
      <div className="w-full flex flex-col items-center">
        <ProfileInput tipText={t("tax_file_tooltip")}>
          <Select
            w={"100%"}
            allowDeselect={false}
            labelProps={{
              fw: "600",
              fz: "xs",
            }}
            label={t("tax_file")}
            withAsterisk
            placeholder={t("tax_file_select")}
            data={Object.keys(BusinessType).map((item) => {
              return {
                value: item,
                label: t(`${BusinessType[item as keyof typeof BusinessType]}`),
              };
            })}
            rightSection={<IconChevronDown />}
            name="businessType"
            value={businessType}
            onChange={(value) => {
              const newType = BusinessType[value as keyof typeof BusinessType];
              form.setFieldValue("data.businessType", newType);
              setBusinessType(value);
            }}
          />
        </ProfileInput>

        <>
          {businessType && businessType != "NONE" && <TaxForm form={form} />}
          {businessType && <BasicInfoForm form={form} />}
        </>

        {businessType && (
          <ProfileInput>
            <Button fullWidth mt={"xl"} type="submit">
              {tb("next")}
            </Button>
          </ProfileInput>
        )}
      </div>
    </Box>
  );
};

export default BusinessForm;
