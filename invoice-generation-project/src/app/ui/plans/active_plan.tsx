import {
  Paper,
  Flex,
  Title,
  Button,
  Text,
  Center,
  Loader,
} from "@mantine/core";
import { IconChevronsUp } from "@tabler/icons-react";
import { formatTotal } from "../../../../utilities/formatters";
import { Currency, SubscriptionPlan } from "@/types";
import { useTranslations } from "next-intl";
import classes from "./Plans.module.css";

const ActivePlan = ({ plan }: { plan: SubscriptionPlan }) => {
  const t = useTranslations("Plans");

  return (
    <Paper p={"lg"} mt={20} radius={"md"} className={classes.paper} shadow="xs">
      {!plan && (
        <Center>
          <Loader />
        </Center>
      )}
      {plan && plan.plan && (
        <Flex justify={"space-between"}>
          <Flex direction={"column"}>
            <Title fw={500} order={2}>
              {t(`${plan.plan.nameEn.toLowerCase()}`)}
            </Title>
            <Text mt={"xs"}>
              {plan.plan.nameEn.toLowerCase() == "free"
                ? t("free_msg")
                : t("unlimited_msg")}
            </Text>
            <Text mt={"md"} c={"dimmed"} size="sm">
              {t("price", {
                price: formatTotal(plan.plan.price, Currency.Shekel),
              })}
            </Text>
          </Flex>

          <Flex direction={"column"}>
            <Text size="xs" c={"dimmed"}>
              {plan.plan.nameEn.toLowerCase() == "free"
                ? t("remaining", {
                    current: plan.currentDocs,
                    max: plan.plan?.maxDocs ?? 0,
                  })
                : t("unlimited_documents")}
            </Text>
            {plan.plan.nameEn.toLowerCase() == "free" && (
              <Button
                mt={"auto"}
                fw={400}
                mb={0}
                fullWidth={false}
                leftSection={<IconChevronsUp stroke={1} />}
              >
                {t("upgrade_plan")}
              </Button>
            )}
          </Flex>
        </Flex>
      )}
    </Paper>
  );
};

export default ActivePlan;
