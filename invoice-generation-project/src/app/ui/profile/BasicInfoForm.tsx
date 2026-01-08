import React, { Fragment } from "react";
import ProfileInput from "./input";
import { TextInput, FileInput } from "@mantine/core";
import { useTranslations } from "next-intl";
import { MultilingualFormData, ProfileData } from "@/types";
import { UseFormReturnType } from "@mantine/form";

interface BasicInfoFormData {
  form: UseFormReturnType<MultilingualFormData<ProfileData>>;
}

const BasicInfoForm = ({ form }: BasicInfoFormData) => {
  const t = useTranslations("Profile");

  return (
    <Fragment>
      <ProfileInput>
        <TextInput
          w={"100%"}
          labelProps={{
            fw: "600",
            fz: "xs",
          }}
          label={t("business_email_lbl")}
          placeholder={t("business_email_ph")}
          name="email"
          withAsterisk
          {...form.getInputProps("data.email")}
        />
      </ProfileInput>
      <ProfileInput>
        <TextInput
          w={"100%"}
          labelProps={{
            fw: "600",
            fz: "xs",
          }}
          label={t("business_phone_lbl")}
          placeholder={t("business_phone_ph")}
          name="phoneNumber"
          {...form.getInputProps("data.phoneNumber")}
        />
      </ProfileInput>
      <ProfileInput tipText={t("logo_tip")}>
        {
          //TODO: handle logo url below
        }
        <FileInput
          w={"100%"}
          labelProps={{
            fw: "600",
            fz: "xs",
          }}
          label={t("logo_lbl")}
          placeholder={t("logo_ph")}
          {...form.getInputProps("data.logoUrl")}
        />
      </ProfileInput>
    </Fragment>
  );
};

export default BasicInfoForm;
