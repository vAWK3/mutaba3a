import {
  Text,
  Container,
  Group,
  Space,
  Flex,
  Center,
  Title,
  Badge,
} from "@mantine/core";

import { getTranslations } from "next-intl/server";
import PageHeader from "@/components/header/pageHeader";
import { AnalyticsPeriod } from "../../../../models/enums/analytics_period";
import { ResponsiveSizeAppShell } from "@/components/mainContainer/customAppShell";
import StyledSegmentedControl from "@/components/select/custom_segmented_control";
import { Suspense } from "react";
import InvoiceCardWrapper from "@/app/ui/dashboard/cards";
import { InvoiceCardsSkeleton } from "@/app/ui/skeletons/cards";
import { MonthlyOverviewSkeleton } from "@/app/ui/skeletons/overview";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import OverviewChart from "@/app/ui/dashboard/overview";
import PercentageChart from "@/app/ui/dashboard/percentage_chart";
import { Currency, DocumentData } from "@/types";
import { formatDate } from "../../../../utilities/formatters";
import { calculateStartDate } from "../../../../utilities/dates";
import SimpleDocumentsTable from "@/app/ui/documents/miniTable";
import SimpleClientsTable from "@/app/ui/clients/miniTable";

const Page = async ({
  searchParams,
  params,
}: {
  searchParams?: {
    currency?: string;
    period?: string;
    verified?: string;
  };
  params: {
    id: string
  };
}) => {
  const currency = searchParams?.currency || Object.keys(Currency)[0];
  const period = searchParams?.period || Object.keys(AnalyticsPeriod)[0];


  //TODO: verify from database as well not only search params
  const verified = searchParams?.verified || "true";

  const t = await getTranslations([
    "Dashboard",
    "Currency",
    "Period",
    "Review",
  ]);

  return (
    <ResponsiveSizeAppShell removeLastPath={true}>
      <Container fluid pb={60}>
        <PageHeader
          title={t("Dashboard.title")}
          subtitle={t("Dashboard.subtitle")}
          buttons={
            <Suspense fallback={<>Loading</>}>
              <Group gap="xs">
                <StyledSegmentedControl
                  variant="secondary"
                  defaultValue={currency}
                  queryTerm="currency"
                  data={Object.keys(Currency).map((key) => ({
                    value: key,
                    label: (
                      <Text fw={"500"} fz={"sm"}>
                        {t(`Currency.${key}`)}
                      </Text>
                    ),
                  }))}
                />
                <StyledSegmentedControl
                  variant="secondary"
                  defaultValue={period}
                  queryTerm="period"
                  data={Object.keys(AnalyticsPeriod).map((key) => ({
                    value: key,
                    label: (
                      <Text fw={"500"} fz={"sm"}>
                        {t(
                          `Period.${AnalyticsPeriod[key as keyof typeof AnalyticsPeriod]
                          }`
                        )}
                      </Text>
                    ),
                  }))}
                />
              </Group>
            </Suspense>
          }
        />
        <Flex direction="row" align="center" mb={"lg"} gap={"sm"}>
          <Badge size="lg" variant="default">
            {t(
              `Dashboard.${AnalyticsPeriod[period as keyof typeof AnalyticsPeriod]
              }`
            )}
          </Badge>
          <Badge size="lg" variant="default">
            {" "}
            {formatDate(
              calculateStartDate(
                AnalyticsPeriod[period as keyof typeof AnalyticsPeriod]
              )
            )}
            {" - "}
            {formatDate(new Date())}
          </Badge>
        </Flex>

        <Center hidden={verified === "true"}>
          <Flex
            align={"center"}
            direction={"column"}
            justify={"center"}
            h={"50vh"}
            ta={"center"}
            w={"30%"}
          >
            <Title order={2}>{t("Review.ttl")}</Title>
            <Text size="sm" c={"dimmed"}>
              {t("Review.msg")}
            </Text>
          </Flex>
        </Center>

        {verified && verified === "true" && (
          <>
            <Suspense fallback={<InvoiceCardsSkeleton />}>
              <InvoiceCardWrapper
                profileId={params.id}
                period={AnalyticsPeriod[period as keyof typeof AnalyticsPeriod]}
                currency={Currency[currency as keyof typeof Currency]}
              />
            </Suspense>

            <Space h={"md"} />

            <Suspense fallback={<MonthlyOverviewSkeleton height={450} />}>
              <ResponsiveGrid mobileSpan={[12, 12]} desktopSpan={[7, 5]}>
                <OverviewChart
                  height={450}
                  period={
                    AnalyticsPeriod[period as keyof typeof AnalyticsPeriod]
                  }
                  currency={currency}
                  profileId={params.id}
                />
                <PercentageChart
                  height={450}
                  profileId={params.id}
                  period={
                    AnalyticsPeriod[period as keyof typeof AnalyticsPeriod]
                  }
                />
              </ResponsiveGrid>
            </Suspense>
            <Space h={"md"} />
            <ResponsiveGrid mobileSpan={[12, 12]} desktopSpan={[6, 6]}>
              <SimpleDocumentsTable
                key={"documents"}
                currency={Currency[currency as keyof typeof Currency]}
                profileId={params.id} />

              <SimpleClientsTable
                key={"clients"}
                profileId={params.id}
              />
            </ResponsiveGrid>
          </>
        )}
      </Container>
    </ResponsiveSizeAppShell>
  );
};

export default Page;
