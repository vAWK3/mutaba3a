import { Flex, Title, Text, Button, Box, rem, Paper } from "@mantine/core";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Currency, FaturaPlan } from "@/types";
import { formatTotal } from "../../../../utilities/formatters";

const PlansCards = ({
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

  const items: Record<string, any>[] = [
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
      unlimited: unlimitedPlan.analytics ? t("coming_soon") : <IconMinus />,
    },
    {
      title: t("import_export"),
      free: freePlan.importExport ? <IconCheck /> : <IconMinus />,
      unlimited: unlimitedPlan.importExport ? t("coming_soon") : <IconMinus />,
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
  ];

  return (
    <>
      {plans.map((plan, index) => {
        return (
          <Paper
            key={index}
            my={"md"}
            radius={"md"}
            bd={"1px solid metal.1"}
            shadow="sm"
            w={"100%"}
          >
            <Flex
              p={"lg"}
              w={"100%"}
              py={rem(30)}
              key={index}
              direction={"column"}
              align={"start"}
            >
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
            {items.map((item, index) => {
              return (
                <Box w={"100%"} key={index}>
                  <Text size="sm" fw={500} my={"md"} px={"md"}>
                    {item.title}
                  </Text>
                  <Box bg={"metal.0"} px={"md"} py={"sm"}>
                    {typeof item.free === "string" ? (
                      <Text size="md">{item[plan.nameEn.toLowerCase()]}</Text>
                    ) : (
                      item[plan.nameEn.toLowerCase()]
                    )}
                  </Box>
                </Box>
              );
            })}
          </Paper>
        );
      })}
    </>
  );
};

export default PlansCards;
