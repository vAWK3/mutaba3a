"use client";
// LanguageForm.tsx
import { TextInput, Text, Flex, Divider, Box } from "@mantine/core";
import { Language, MultilingualFormData } from "@/types";
import { useTranslations } from "next-intl";
import { fontAr, fontEn } from "../fonts";
import { ProfileData } from "@/types";
import { UseFormReturnType } from "@mantine/form";

interface LanguageFormProps {
  language: Language;
  form: UseFormReturnType<MultilingualFormData<ProfileData>>;
  // errors: ProfileErrorData;
  // formData?: ProfileData;
  // handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const LanguageForm = ({
  language,
  // formData,
  form,
}: // errors,
// handleInputChange,
LanguageFormProps) => {
  const t = useTranslations("Profile");

  return (
    <Flex w={"100%"} direction={"column"} gap={"xs"}>
      <Box>
        <Text
          className={
            language == Language.ar ? fontAr.className : fontEn.className
          }
          size="sm"
          fw={400}
        >
          {language}
        </Text>
        <Divider />
      </Box>
      <TextInput
        placeholder={t("display_name_ph")}
        label={t("display_name_lbl")}
        labelProps={{
          fz: "xs",
          fw: 600,
        }}
        size="sm"
        fz={"sm"}
        withAsterisk
        name="name"
        {...form.getInputProps(
          language == Language.ar
            ? "data.nameAr"
            : language == Language.en
            ? "data.nameEn"
            : "data.nameHe"
        )}
        // error={errors.name}
        // value={formData?.name}
        // onChange={(e) => handleInputChange(e)}
      />
      <TextInput
        placeholder={t("address_ph")}
        label={t("address_lbl")}
        // error={errors.address1}
        labelProps={{
          fz: "xs",
          fw: 600,
        }}
        size="sm"
        fz={"sm"}
        withAsterisk
        name="address.address1"
        {...form.getInputProps(
          language == Language.ar
            ? "data.address.address1Ar"
            : language == Language.en
            ? "data.address.address1En"
            : "data.address.address1He"
        )}
        // value={
        //   language == Language.ar
        //     ? formData?.address.address1Ar
        //     : language == Language.en
        //     ? formData?.address.address1En
        //     : formData?.address.address1He
        // }
        // onChange={(e) => handleInputChange(e)}
      />
      <TextInput
        placeholder={t("city_ph")}
        label={t("city_lbl")}
        labelProps={{
          fz: "xs",
          fw: 600,
        }}
        size="sm"
        fz={"sm"}
        withAsterisk
        name="address.city"
        {...form.getInputProps(
          language == Language.ar
            ? "data.address.cityAr"
            : language == Language.en
            ? "data.address.cityEn"
            : "data.address.cityHe"
        )}
        // error={errors.city}
        // value={
        //   language == Language.ar
        //     ? formData?.address.cityAr
        //     : language == Language.en
        //     ? formData?.address.cityEn
        //     : formData?.address.cityHe
        // }
        // onChange={(e) => handleInputChange(e)}
      />
      <TextInput
        placeholder={t("country_ph")}
        label={t("country_lbl")}
        labelProps={{
          fz: "xs",
          fw: 600,
        }}
        size="sm"
        fz={"sm"}
        name="address.country"
        {...form.getInputProps(
          language == Language.ar
            ? "data.address.countryAr"
            : language == Language.en
            ? "data.address.countryEn"
            : "data.address.countryHe"
        )}
        // error={errors.country}
        // value={
        //   language == Language.ar
        //     ? formData?.address.countryAr
        //     : language == Language.en
        //     ? formData?.address.countryEn
        //     : formData?.address.countryHe
        // }
        // onChange={(e) => handleInputChange(e)}
      />
      <TextInput
        placeholder={t("zipcode_ph")}
        label={t("zipcode_lbl")}
        labelProps={{
          fz: "xs",
          fw: 600,
        }}
        size="sm"
        fz={"sm"}
        name="address.postalCode"
        {...form.getInputProps("data.address.postalCode")}
        // error={errors.postalCode}
        // value={formData?.address.postalCode}
        // onChange={(e) => handleInputChange(e)}
      />
    </Flex>
  );
};
