import { Button, Flex, Paper, Title, Text, Space, Box } from "@mantine/core";

import { IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import { AnalyticsPeriod } from "../../../../models/enums/analytics_period";
import { getTranslations } from "next-intl/server";
import { formatTotal } from "../../../../utilities/formatters";
import PercentageTag from "@/components/tags/percentage_tag";

import { fetchClients } from "@/app/lib/data";
import classes from "./Dashboard.module.css";
import ClientRow from "./client_row";
import { ClientData } from "@/types";
interface TotalEarningsProps {
  period: AnalyticsPeriod;
  currency: string;
  height: number;
}

export function getTotal(clients: ClientData[]): number {
  const total = clients.reduce(
    (sum, client) => sum + (client.data?.outstandingInvoices ?? 0),
    0
  );

  return total;
}

export function getTop3Clients(clients: ClientData[]): ClientData[] {
  // Sort clients by outstandingInvoices in descending order
  const sortedClients = clients.sort(
    (a, b) =>
      (b.data?.outstandingInvoices ?? 0) - (a.data?.outstandingInvoices ?? 0)
  );

  // Take the top 3 clients
  const top3Clients = sortedClients.slice(0, 3);

  return top3Clients;
}

async function EarningsOverview({
  period,
  currency,
  height,
}: TotalEarningsProps) {
  const t = await getTranslations("Dashboard");

  const clients = await fetchClients(period);

  const data = getTop3Clients(clients);

  const total = getTotal(clients);

  return (
    <Paper className={classes.container} radius={"md"} w={"100%"} h={height}>
      <Flex direction={"column"} align={"start"} justify={"start"}>
        <Text mx={"lg"} mt={"lg"} fw={600} size="md" m={0}>
          {t("total_earnings")}
        </Text>
        <Text mx={"lg"} c="dimmed" fw={400} size="sm" m={0}>
          {t(`${period}`)}
        </Text>

        <Title mx={"lg"} order={1} ff={"monospace"} mt={"xs"} fw={500}>
          {formatTotal(total, currency)}
        </Title>
        <Box mx={"lg"} mb={"lg"}>
          <PercentageTag value={0.3} />
        </Box>

        {data &&
          data.map((item, index) => {
            return (
              <ClientRow
                px={"lg"}
                client={item}
                key={index}
                documentLabel={t("lbl_documents")}
                progress={((item.data?.outstandingInvoices ?? 0) / total) * 100}
              />
            );
          })}

        <Button
          mt={"md"}
          mx={"sm"}
          variant="outline"
          bd={"transparent"}
          fw={400}
          size="xs"
          component={Link}
          href={"/clients"}
          rightSection={<IconChevronRight size={12} />}
        >
          {t("see_all_clients")}
        </Button>
      </Flex>
    </Paper>
  );
}

export default EarningsOverview;
