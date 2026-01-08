import { Box, Title, Divider, rem, Loader, Center } from "@mantine/core";
import { usePlan, usePlans } from "@/hooks/usePlan";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useTranslations } from "next-intl";
import ActivePlan from "@/app/ui/plans/active_plan";

import PlansTable from "@/app/ui/plans/table";
import PlansCards from "@/app/ui/plans/cards";

const PlanSettings = () => {
  const user = useUser();
  const { plan } = usePlan(user.user?.sub ?? "1");
  const { plans } = usePlans();
  const t = useTranslations("Plans");

  return (
    <>
      <Box w={"100%"}>
        <Title order={4} fw={500} mb={rem(12)}>
          {t("active_plan")}
        </Title>
        <Divider />
        {plan && plan.plan && <ActivePlan plan={plan} />}
        {!plan && (
          <Center mt={"xl"}>
            <Loader />
          </Center>
        )}
      </Box>
      <Box w={"100%"} mt={rem(50)}>
        <Title order={4} fw={500} mb={rem(12)}>
          {t("all_plans")}
        </Title>
        <Divider />
        {plans && (
          <>
            <Box visibleFrom="sm">
              <PlansTable plans={plans} canUpgrade={plan?.plan?.maxDocs != 0} />
            </Box>
            <Box hiddenFrom="sm">
              <PlansCards plans={plans} canUpgrade={plan?.plan?.maxDocs != 0} />
            </Box>
          </>
        )}
        {!plans && (
          <Center mt={"xl"}>
            <Loader />
          </Center>
        )}
      </Box>
    </>
  );
};

export default PlanSettings;
