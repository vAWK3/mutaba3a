import { Button, Flex, Group, Paper, Text, Space } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";

import { AnalyticsPeriod } from "../../../../models/enums/analytics_period";
import { fetchClients } from "@/app/lib/data";
import { getTranslations } from "next-intl/server";

import classes from "./Dashboard.module.css";
import ClientRow from "./client_row";
import { ClientData } from "@/types";

interface RecentClientsProps {
  period: AnalyticsPeriod;
}

async function RecentClients({ period }: RecentClientsProps) {
  const clients = await fetchClients(period);

  const t = await getTranslations(["Dashboard", "Buttons"]);

  const data: ClientData[] = clients.slice(0, 4);

  return (
    <Paper className={classes.container} radius={"md"} w={"100%"}>
      <Flex direction={"column"} align={"start"} justify={"start"}>
        <Group px={"lg"} mt={"lg"} mb={"md"} justify="space-between" w={"100%"}>
          <Text fw={600} size="md" m={0}>
            {t("Dashboard.recent_clients")}
          </Text>
          <Button
            variant="default"
            title="New client"
            component={Link}
            href={"/clients/new"}
          >
            {t("Buttons.new_client")}
          </Button>
        </Group>

        {data &&
          data.map((item, index) => {
            return (
              <ClientRow
                client={item}
                key={index}
                withTotal={false}
                px={"lg"}
                documentLabel={t("Dashboard.lbl_documents")}
              />
            );
          })}

        <Button
          mt={"md"}
          mx={"sm"}
          mb={"lg"}
          variant="outline"
          bd={"transparent"}
          fw={400}
          size="xs"
          component={Link}
          href={"/clients"}
          rightSection={<IconChevronRight size={"18px"} />}
        >
          {t("Dashboard.see_all_clients")}
        </Button>
      </Flex>
    </Paper>
  );
}

export default RecentClients;
