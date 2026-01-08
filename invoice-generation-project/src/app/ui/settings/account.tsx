import {
  Box,
  Title,
  Divider,
  rem,
  Button,
  Avatar,
  Group,
  TextInput,
} from "@mantine/core";

import SettingsGroup from "../../../components/settings/settings_group";
import { getInitials } from "../../../../utilities/formatters";
import { useTranslations } from "next-intl";
import { useUser } from "@auth0/nextjs-auth0/client";
import ActivePlan from "@/app/ui/plans/active_plan";
import { usePlan } from "@/hooks/usePlan";

const AccountSettings = () => {
  const user = useUser();

  const { plan } = usePlan(user?.user?.sub ?? "1");

  const t = useTranslations("Settings");

  return (
    <>
      <Box w={"100%"} my={rem(30)}>
        <Title order={4} size={"md"} fw={500} mb={rem(12)}>
          {t("profile")}
        </Title>
        <Divider />
        <Group mt={rem(20)}>
          <Avatar color={"blue"} radius={4} size={"xl"}>
            {getInitials(user?.user?.name)}
          </Avatar>
          <TextInput label={t("name")} defaultValue={user?.user?.name ?? ""} />
        </Group>
      </Box>
      <SettingsGroup
        title={t("security")}
        items={[
          {
            title: t("email"),
            description: user?.user?.email ?? "",
            action: (
              <Button fullWidth fw={400} size="sm" variant="default">
                {t("change_email")}
              </Button>
            ),
          },
        ]}
      />
      <Box w={"100%"} my={rem(20)}>
        <Title order={4} fw={500} mb={rem(12)}>
          {t("active_plan")}
        </Title>
        <Divider />
        {plan && <ActivePlan plan={plan} />}
      </Box>
      <SettingsGroup
        title={t("information")}
        items={[
          {
            title: t("logout_ttl"),
            description: t("logout_msg"),
            action: (
              <Button fullWidth fw={400} size="sm" variant="default">
                {t("logout_act")}
              </Button>
            ),
          },
          {
            title: t("delete_account_ttl"),
            description: t("delete_account_msg"),
            action: (
              <Button fullWidth fw={400} size="sm" variant="light" color="red">
                {t("delete_account_act")}
              </Button>
            ),
          },
        ]}
      />
    </>
  );
};

export default AccountSettings;
