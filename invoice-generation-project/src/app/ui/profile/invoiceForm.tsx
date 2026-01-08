import { Box, Button, Center, Flex, Space, Text, Title } from "@mantine/core";
import { useTranslations } from "next-intl";
import React, { useState } from "react";

import LanguageButtons from "./LanguageButtons";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import { LanguageForm } from "./languageForm";
import { ProfileData, Language, MultilingualFormData } from "@/types";
import { UseFormReturnType } from "@mantine/form";

interface InvoiceFormProps {
  title: string[];
  form: UseFormReturnType<MultilingualFormData<ProfileData>>;
}

const InvoiceForm = ({ title, form }: InvoiceFormProps) => {
  const t = useTranslations("Profile");
  const tb = useTranslations("Buttons");

  const [shouldShowAr, setShouldShowAr] = useState(false);
  const [shouldShowHe, setShouldShowHe] = useState(false);
  const [shouldShowEn, setShouldShowEn] = useState(true);

  return (
    <Box w={"100%"}>
      <Title order={2} ta={"center"}>
        {title[0]}
      </Title>
      <Title order={2} mb={"xs"} ta={"center"}>
        {title[1]}
      </Title>
      <div>
        <Text size="sm" c={"dimmed"} mb={"lg"} ta={"center"}>
          {t("change_later_settings")}
        </Text>
        <Center>
          <LanguageButtons
            setShouldShowAr={(v) => {
              if (v) {
                setShouldShowAr(true);
                form.setFieldValue("ar", true);
              } else if (shouldShowEn || shouldShowHe) {
                setShouldShowAr(false);
                form.setFieldValue("ar", false);
              }
            }}
            setShouldShowEn={(v) => {
              if (v) {
                setShouldShowEn(true);
                form.setFieldValue("en", true);
              } else if (shouldShowAr || shouldShowHe) {
                setShouldShowEn(false);
                form.setFieldValue("en", false);
              }
            }}
            setShouldShowHe={(v) => {
              if (v) {
                setShouldShowHe(true);
                form.setFieldValue("he", true);
              } else if (shouldShowEn || shouldShowAr) {
                setShouldShowHe(false);
                form.setFieldValue("he", false);
              }
            }}
            shouldShowAr={shouldShowAr}
            shouldShowEn={shouldShowEn}
            shouldShowHe={shouldShowHe}
          />
        </Center>
        <Space h="lg" />
      </div>
      <ResponsiveGrid desktopSpan={[4, 4, 4]} mobileSpan={[12]}>
        {shouldShowAr && !shouldShowEn && <div></div>}
        {shouldShowEn && shouldShowHe && !shouldShowAr && <div></div>}
        {shouldShowAr && <LanguageForm form={form} language={Language.ar} />}
        {shouldShowEn && <LanguageForm form={form} language={Language.en} />}
        {shouldShowHe && <LanguageForm form={form} language={Language.he} />}
      </ResponsiveGrid>
      <Button hiddenFrom="sm" mt={"xl"} fullWidth type="submit">
        {tb("submit")}
      </Button>
      <Flex
        w={"100%"}
        visibleFrom="sm"
        justify={
          (!shouldShowAr && !shouldShowEn) ||
          (!shouldShowAr && !shouldShowHe) ||
          (!shouldShowHe && !shouldShowEn)
            ? "center"
            : shouldShowHe
            ? "flex-end"
            : shouldShowEn
            ? "center"
            : "flex-start"
        }
        mt={"lg"}
      >
        <Button w={"32%"} type="submit">
          {tb("submit")}
        </Button>
      </Flex>
    </Box>
  );
};

export default InvoiceForm;
