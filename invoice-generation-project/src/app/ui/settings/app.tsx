import { Box, rem, Button } from "@mantine/core";
import SettingsGroup from "../../../components/settings/settings_group";
import { IconExternalLink } from "@tabler/icons-react";
import ThemeToggle from "../../../components/ThemeToggle";
import { useTranslations } from "next-intl";

const AppSettings = () => {
  const t = useTranslations("Settings");
  const tb = useTranslations("Buttons");

  return (
    <>
      <Box mb={50}>
        <SettingsGroup
          title={t("settings")}
          items={[
            {
              title: t("appearance_ttl"),
              description: t("appearance_msg"),
              action: <ThemeToggle />,
            },
          ]}
        ></SettingsGroup>
      </Box>
      <Box mb={50}>
        <SettingsGroup
          title={t("clients")}
          items={[
            {
              title: t("export_ttl"),
              description: t("export_msg", {
                type: t("clients").toLowerCase(),
              }),
              action: (
                <Button fullWidth fw={400} size="sm" variant="default">
                  {tb("export")}
                </Button>
              ),
            },
            {
              title: t("import_ttl"),
              description: t("import_msg", {
                type: t("clients").toLowerCase(),
              }),
              action: (
                <Button fullWidth fw={400} size="sm" variant="default">
                  {tb("import")}
                </Button>
              ),
            },
          ]}
        />
      </Box>
      <Box mb={50}>
        <SettingsGroup
          title={t("documents")}
          items={[
            {
              title: t("export_ttl"),
              description: t("export_msg", {
                type: t("documents").toLowerCase(),
              }),
              action: (
                <Button fullWidth fw={400} size="sm" variant="default">
                  {tb("export")}
                </Button>
              ),
            },
            {
              title: t("import_ttl"),
              description: t("import_msg", {
                type: t("documents").toLowerCase(),
              }),
              action: (
                <Button fullWidth fw={400} size="sm" variant="default">
                  {tb("import")}
                </Button>
              ),
            },
          ]}
        />
      </Box>
      <SettingsGroup
        title={t("privacy")}
        items={[
          {
            title: t("terms_use"),
            description: t("terms_msg"),
            action: (
              <Button
                justify="space-between"
                fullWidth
                fw={400}
                size="sm"
                variant="default"
                rightSection={<IconExternalLink stroke={"1.5px"} size={"20"} />}
              >
                {t("terms_use")}
              </Button>
            ),
          },
          {
            title: t("privacy_policy"),
            description: t("privacy_msg"),
            action: (
              <Button
                justify="space-between"
                fullWidth
                fw={400}
                size="sm"
                variant="default"
                rightSection={<IconExternalLink stroke={"1.5px"} size={"20"} />}
              >
                {t("privacy_policy")}
              </Button>
            ),
          },
        ]}
      />
    </>
  );
};

export default AppSettings;
