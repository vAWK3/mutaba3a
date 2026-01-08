import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import ComparisonChart from "./comparison";
import { Flex, Title, Text, Button, Box, rem } from "@mantine/core";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Currency, FaturaPlan } from "@/types";
import { formatTotal } from "../../../../utilities/formatters";

const PlansTable = ({
  plans,
  canUpgrade,
}: {
  plans: FaturaPlan[];
  canUpgrade: boolean;
}) => {
  const t = useTranslations("Plans");

  const freePlan = plans.filter(
    (item) => item.nameEn.toLowerCase() === "free"
  )[0];
  const unlimitedPlan = plans.filter(
    (item) => item.nameEn.toLowerCase() === "unlimited"
  )[0];

  return (
    <>
      <ResponsiveGrid desktopSpan={[4, 4, 4]} mobileSpan={[12]}>
        <></>
        {Array.from({ length: 2 }).map((_, index) => {
          let plan = plans[index];

          if (index == 0 && plan.nameEn.toLowerCase() == "unlimited") {
            plan = plans[1];
          } else if (index == 1 && plan.nameEn.toLowerCase() == "free") {
            plan = plans[0];
          }

          return (
            <Flex py={rem(30)} key={index} direction={"column"} align={"start"}>
              <Title fw={500} order={2}>
                {t(`${plan.nameEn.toLowerCase()}`)}
              </Title>
              <Text>
                {plan.maxDocs > 0
                  ? t("allowed_documents", {
                      number: plan.maxDocs,
                    })
                  : t("unlimited_documents")}
              </Text>
              <Text mt={"sm"} c={"dimmed"} size="sm">
                {t("price", {
                  price: formatTotal(plan.price, Currency.Shekel),
                })}
              </Text>
              {canUpgrade && plan.maxDocs == 0 && (
                <Button mt={"sm"} w={"50%"} fw={400} fullWidth={false}>
                  {t("upgrade_plan")}
                </Button>
              )}
            </Flex>
          );
        })}
      </ResponsiveGrid>

      <ComparisonChart
        items={[
          {
            title: t("documents"),
            free: t("allowed_documents", {
              number: freePlan.maxDocs,
            }),
            unlimited: t("unlimited_documents"),
          },
          {
            title: t("clients"),
            free: t("allowed_clients", {
              number: freePlan.maxClients,
            }),

            unlimited: t("unlimited"),
          },
          {
            title: t("analytics"),
            free: freePlan.analytics ? <IconCheck /> : <IconMinus />,
            unlimited: unlimitedPlan.analytics ? (
              t("coming_soon")
            ) : (
              <IconMinus />
            ),
          },
          {
            title: t("import_export"),
            free: freePlan.importExport ? <IconCheck /> : <IconMinus />,
            unlimited: unlimitedPlan.importExport ? (
              t("coming_soon")
            ) : (
              <IconMinus />
            ),
          },
          {
            title: t("customization"),
            free: freePlan.invoiceCustomization ? <IconCheck /> : <IconMinus />,
            unlimited: unlimitedPlan.invoiceCustomization ? (
              <IconCheck />
            ) : (
              <IconMinus />
            ),
          },
        ]}
      />
    </>
  );
};

export default PlansTable;
