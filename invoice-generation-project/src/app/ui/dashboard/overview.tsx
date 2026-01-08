import { BarChart } from "@mantine/charts";
import { Center, Flex, Group, Paper, Text } from "@mantine/core";
import { AnalyticsPeriod } from "../../../../models/enums/analytics_period";
import { getTranslations } from "next-intl/server";
import classes from "./Dashboard.module.css";
import { makeGetRequest } from "@/app/api/api";
import { Currency, DocumentStatus } from "@/types";
interface MonthlyOverviewProps {
  profileId: string;
  period: AnalyticsPeriod;
  currency: string;
  height: number;
}
//TODO: change the colors to meet the classname
async function OverviewChart({
  profileId,
  period,
  currency,
  height,
}: MonthlyOverviewProps) {

  const data = await makeGetRequest(`/api/analytics/${profileId}?period=${period}`);

  const t = await getTranslations("Dashboard");

  {
    //TODO: redesign empty results and translate message
  }

  return <Paper
    className={classes.container}
    radius={"md"}
    h={height}
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
        <Flex direction={"column"} align={"start"} justify={"start"}>
          <Text fw={500} size="lg" m={0}>
            {t("invoice_overview")}
          </Text>
          <Text c="dimmed" fw={400} size="sm" m={0}>
            {t(`${period}`)}
          </Text>
        </Flex>
      </Group>
      {data && data.length ? <BarChart
        h={0.8 * height}
        mih={200}
        w={"100%"}
        data={data}
        dataKey={getDataKey(period)}
        type="stacked"
        strokeDasharray={0}
        unit={Currency[currency as keyof typeof Currency]}
        withLegend
        barProps={{
          radius: [8, 8, 8, 8],
        }}
        barChartProps={{
          barCategoryGap: 6,
          maxBarSize: 60,
          barGap: 12,
        }}
        series={Object.keys(DocumentStatus).map((item) => {
          const color =
            item == "Overdue"
              ? "red.4"
              : item == "Pending"
                ? "purple.4"
                : "blue.6";
          return { name: item, color: color };
        })}

      /> :

        <Flex h={0.8 * height} w={"100%"} align={"center"} justify={"center"}><Text>No data, create your first invoice to see more analytics</Text></Flex>}
    </Flex>
  </Paper>;

}

function getDataKey(period: AnalyticsPeriod): string {
  switch (period) {
    case "30D":
      return "day";
    case AnalyticsPeriod.Months6:
      return "month";
    case AnalyticsPeriod[AnalyticsPeriod.YTD as keyof typeof AnalyticsPeriod]:
    case AnalyticsPeriod[AnalyticsPeriod.Year1 as keyof typeof AnalyticsPeriod]:
      return "quarter";
    default:
      return "error";
  }
}

export default OverviewChart;
