"use client";

import { Box, Button, rem, Select } from "@mantine/core";
import SettingsGroup from "../../../components/settings/settings_group";

import { IconChevronDown } from "@tabler/icons-react";
import LocaleSwitcher from "../../../components/language/language_switcher";
import { useTranslations } from "next-intl";

const LanguageSettings = () => {
  const t = useTranslations("Settings");

  return (
    <>
      <Box mb={50}>
        <SettingsGroup
          title={t("app_language")}
          items={[
            {
              title: t("language"),
              description: t("language_msg"),
              action: <LocaleSwitcher iconOnly={false} />,
            },
          ]}
        ></SettingsGroup>
      </Box>
      <SettingsGroup
        title={t("invoice_language")}
        items={[
          {
            title: t("invoice_language_ttl"),
            description: t("invoice_language_msg"),
            action: (
              <Select
                allowDeselect={false}
                defaultValue={"العربية"}
                variant="default"
                checkIconPosition="right"
                data={["العربية", "English", "עברית"]}
              />
            ),
          },
        ]}
      />
    </>
  );
};

export default LanguageSettings;
