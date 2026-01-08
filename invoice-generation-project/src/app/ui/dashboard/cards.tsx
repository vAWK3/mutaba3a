import { Box, Button, Flex, Group, Paper, Text, Title } from "@mantine/core";
import Link from "next/link";
// import { fetchInvoiceData } from "@/app/lib/data";
import { AnalyticsPeriod } from "../../../../models/enums/analytics_period";
import PercentageTag from "@/components/tags/percentage_tag";

import { formatTotal } from "../../../../utilities/formatters";
import { getTranslations } from "next-intl/server";
import { EqualResponsiveGrid } from "@/components/grid/equal_responsive_grid";
import classes from "./Dashboard.module.css";
import { makeGetRequest } from "@/app/api/api";
import { useContext } from "react";
import { ProfileContext } from "@/contexts/ProfileContext";

const colorMap = {
  Invoiced: classes.invoiced,
  Paid: classes.paid,
  Pending: classes.pending,
  Overdue: classes.overdue,
};

export default async function InvoiceCardWrapper({
  profileId,
  period,
  currency,
}: {
  profileId: string;
  period: AnalyticsPeriod;
  currency: string;
}) {
  const t = await getTranslations("Dashboard");

  // const Invoiced = { amount: 0, trend: 0 };
  // const Overdue = { amount: 0, trend: 0 };
  // const Pending = { amount: 0, trend: 0 };
  // const Paid = { amount: 0, trend: 0 };

  const data = await makeGetRequest(`/api/analytics/${profileId}?period=${period}&type=invoice`);

  const { Invoiced, Overdue, Pending, Paid } = data[0];

  console.log('*** IN CARDS *** \n\n\ndata is ', data);

  console.log('invoiced is ', Invoiced);



  //TODO: Boxes are not showing in Arabic

  return (
    <EqualResponsiveGrid desktopSpan={3} mobileSpan={6}>

      <InvoiceCardAnalytics
        title={t("Invoiced")}
        description={t("Invoiced_Description")}
        type="Invoiced"
        value={Invoiced}
        currency={currency}
        profileId={profileId}
      />
      <InvoiceCardAnalytics
        title={t("Overdue")}
        description={t("Overdue_Description")}
        type="Overdue"
        value={Overdue}
        currency={currency}
        profileId={profileId}
      />
      <InvoiceCardAnalytics
        title={t("Pending")}
        description={t("Pending_Description")}
        type="Pending"
        value={Pending}
        currency={currency}
        profileId={profileId}
      />
      <InvoiceCardAnalytics
        title={t("Paid")}
        description={t("Paid_Description")}
        type="Paid"
        value={Paid}
        currency={currency}
        profileId={profileId}
      />
    </EqualResponsiveGrid>
  );
}

interface InvoiceTotalAnalyticsProps {
  title: string;
  description: string;
  type: string;
  value: { amount: number; trend: number };
  currency: string;
  profileId: string | number | undefined;
}

export function InvoiceCardAnalytics({
  title,
  description,
  type,
  value,
  currency,
  profileId,
}: InvoiceTotalAnalyticsProps) {
  const Color = colorMap[type as keyof typeof colorMap];
  // className={`${colorMap[item as keyof typeof colorMap]}`}


  console.log('value is ', value);

  return (
    <Paper
      className={`${classes.container} ${classes.item}`}
      component={Link}
      href={`${profileId}/documents?docType=Invoice${title == undefined ? "" : `&status=${title}`
        }`}
      radius={"md"}
      w={"100%"}
      p={"md"}
    >
      <Flex direction={"column"} align={"start"} justify={"start"}>
        <Group
          gap={"xs"}
          mb={"xs"}
          justify="space-between"
          align="center"
          w={"100%"}
        >
          <Flex direction={"row"} align={"center"}>
            <Box
              // bg={Color}
              className={`${Color} mr-3 ml-0 rtl:mr-0 rtl:ml-3`}
              size="xs"
              h={40}
              w={4}
              style={{ borderRadius: "4px" }}
            />
            <Flex direction={"column"} p={0}>
              <Text fw={500} size="lg" m={0}>
                {title}
              </Text>
              <Text c="dimmed" fw={400} size="sm" m={0}>
                {description}
              </Text>
            </Flex>
          </Flex>
        </Group>
        <Title
          ff={"monospace"}
          fw={500}
          fz={{ base: "h3", md: "h2" }}
          mb={"xs"}
        >
          {formatTotal(value.amount, currency)}
        </Title>
        <PercentageTag value={value.trend} />
      </Flex>
    </Paper>
  );
}
