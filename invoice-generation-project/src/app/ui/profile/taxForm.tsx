import React, { Fragment } from "react";
import ProfileInput from "./input";
import { NumberInput, FileInput, TextInput } from "@mantine/core";
import { useTranslations } from "next-intl";
import { ProfileData, MultilingualFormData } from "@/types";
import { UseFormReturnType } from "@mantine/form";

interface TaxFormData {
  form: UseFormReturnType<MultilingualFormData<ProfileData>>;
}

export const TaxForm = ({ form }: TaxFormData) => {
  const t = useTranslations("Profile");

  return (
    <Fragment>
      <ProfileInput tipText={t("tax_id_tip")}>
        <TextInput
          w={"100%"}
          label={t("tax_id_lbl")}
          labelProps={{
            fw: "600",
            fz: "xs",
          }}
          placeholder={t("tax_id_ph")}
          name="taxId"
          withAsterisk
          maxLength={9}
          {...form.getInputProps("data.taxId")}
        />
      </ProfileInput>
      <ProfileInput tipText={t("business_certificate_tip")}>
        {
          //TODO: handle certificate below
        }
        <FileInput
          w={"100%"}
          labelProps={{
            fw: "600",
            fz: "xs",
          }}
          label={t("business_certificate_lbl")}
          placeholder={t("business_certificate_ph")}
          {...form.getInputProps("data.businessCertificate")}
          withAsterisk
        />
      </ProfileInput>
    </Fragment>
  );
};
