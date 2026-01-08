// import { fetchAnalytics } from "@/app/lib/data";
import {
  Box,
  Flex,
  Group,
  Paper,
  Title,
  Text,
  Tooltip,
  ProgressRoot,
  ProgressSection,
  Divider,
} from "@mantine/core";
import { AnalyticsPeriod } from "../../../../models/enums/analytics_period";
import { getTranslations } from "next-intl/server";
import classes from "./Dashboard.module.css";
import { makeGetRequest } from "@/app/api/api";
import { IconChartGridDots } from "@tabler/icons-react";
interface DocumentsOverviewProps {
  period: AnalyticsPeriod;
  profileId: string;
  height: number;
}

const colorMap = {
  Paid: classes.paid,
  Pending: classes.pending,
  Overdue: classes.overdue,
};

async function PercentageChart({ profileId, period, height }: DocumentsOverviewProps) {

  const chartData = {

    Overdue: 0,
    Paid: 0,
    Pending: 0,
  };

  const data = await makeGetRequest(`/api/analytics/${profileId}?period=${period}&percent=true`);

  console.log('*** IN PERECENT CHART *** \n\n\n data is \n\n', data);

  const t = await getTranslations("Dashboard");

  if (data) {
    if (data[0].Overdue) {
      chartData.Overdue = data[0].Overdue;
    }
    if (data[0].Paid) {
      chartData.Paid = data[0].Paid;
    }
    if (data[0].Pending) {
      chartData.Pending = data[0].Pending;
    }
  }

  const total = chartData.Overdue + chartData.Paid + chartData.Pending

  return (
    <Paper
      className={classes.container}
      radius={"md"}
      w={"100%"}
      p={"lg"}
      h={height}
    >
      <Flex direction={"column"} align={"start"} justify={"start"}>
        <Text fw={500} size="lg" m={0}>
          {t("invoice_status")}
        </Text>
        <Text c="dimmed" fw={400} size="sm" m={0}>
          {t(`${period}`)}
        </Text>

        <ProgressRoot size="xl" h={24} w={"100%"} radius={"sm"} mt={"md"}>
          {Object.keys(chartData).map((item, index) => {
            return (
              <Tooltip
                key={index}
                label={`${(
                  (chartData[item as keyof typeof chartData] / total) *
                  100
                ).toFixed(0)}% ${t(`${item}`)}`}
              >
                <ProgressSection
                  value={(chartData[item as keyof typeof chartData] / total) * 100}
                  className={`${colorMap[item as keyof typeof colorMap]}`}
                />
              </Tooltip>
            );
          })}
        </ProgressRoot>
        <Title order={2} fw={400} mt={"md"} mb={"sm"}>
          {`${total} ${t("lbl_documents")}`}
        </Title>

        {Object.keys(chartData).map((item, index) => {
          return (
            <Group
              key={index}
              mt={"md"}
              gap={"xs"}
              justify="space-between"
              align="center"
              w={"100%"}
            >
              <Group align={"center"}>
                <Box
                  // bg={colorMap[item as keyof typeof colorMap]}
                  className={`${colorMap[item as keyof typeof colorMap]}`}
                  size="xs"
                  h={36}
                  w={4}
                  style={{ borderRadius: "4px" }}
                />
                <Flex direction={"column"} p={0}>
                  <Text fw={500} fz={"md"} m={0}>
                    {t(`${item}`)}
                  </Text>
                  <Text m={0} size="sm" c={"dimmed"}>
                    {`${chartData[item as keyof typeof chartData]} ${t("lbl_documents")}`}
                  </Text>
                </Flex>
              </Group>
              <Text fw={500} fz={"md"} ff={"monospace"}>{`${(
                (chartData[item as keyof typeof chartData] / total) *
                100
              ).toFixed(0)}%`}</Text>
            </Group>
          );
        })}
      </Flex>
    </Paper>
  );
}

export default PercentageChart;
