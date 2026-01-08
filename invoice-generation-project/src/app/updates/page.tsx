import {
  Timeline,
  Text,
  List,
  Flex,
  Group,
  rem,
  TimelineItem,
  ListItem,
} from "@mantine/core";

import { ResponsiveSizeAppShell } from "@/components/mainContainer/customAppShell";
import PageHeader from "@/components/header/pageHeader";
import { IconPoint } from "@tabler/icons-react";

import { getTranslations } from "next-intl/server";
import { formatDate } from "../../../utilities/formatters";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import { fetchUpdates } from "../lib/data";

const UpdatesPage = async () => {
  const updates = await fetchUpdates();
  const t = await getTranslations("Updates");

  return (
    <ResponsiveSizeAppShell>
      <Flex direction={"column"} pb={rem(60)} w={"100%"}>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />

        <ResponsiveGrid desktopSpan={[3, 6, 3]} mobileSpan={[12]}>
          <></>
          <Timeline w={"100%"} active={-1} bulletSize={21} lineWidth={3}>
            {updates &&
              updates.map((item, index) => {
                return (
                  <TimelineItem
                    key={index}
                    title={
                      <div>
                        <Text fw={500} fz={rem(28)}>
                          {`Version ${item.version}`}
                        </Text>
                        <Text fw={400} c={"dimmed"}>
                          {formatDate(item.timestamp, "DD MMMM, YYYY")}
                        </Text>
                      </div>
                    }
                  >
                    <Text fw={500} size="lg" mt={"lg"}>
                      {`What's new in version ${item.version}`}
                    </Text>
                    <List>
                      {item.features.map((item, index) => {
                        return (
                          <ListItem key={index}>
                            <Group>
                              <IconPoint fill="black" size={12} />
                              <Text fw={400} fz={rem(14)}>
                                {item}
                              </Text>
                            </Group>
                          </ListItem>
                        );
                      })}
                    </List>
                  </TimelineItem>
                );
              })}
          </Timeline>
          <></>
        </ResponsiveGrid>
      </Flex>
    </ResponsiveSizeAppShell>
  );
};

export default UpdatesPage;
