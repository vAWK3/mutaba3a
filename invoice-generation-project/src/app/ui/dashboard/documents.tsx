import {
  Button,
  Flex,
  Group,
  Paper,
  Text,
  Space,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import { fetchDocuments } from "@/app/lib/data";
import CreateDocumentButton from "@/components/buttons/create_document_button";
import { AnalyticsPeriod } from "../../../../models/enums/analytics_period";
import { formatTotal } from "../../../../utilities/formatters";
import { getTranslations } from "next-intl/server";
import { DocumentData } from "@/types";
import classes from "./Dashboard.module.css";
import { useContext } from "react";
import { ProfileContext } from "@/contexts/ProfileContext";

//TODO: implement curency conversion (currency on each item + rate exchange for currencies)

async function RecentDocuments({
  period,
  currency,
}: {
  period: AnalyticsPeriod;
  currency: string;
}) {
  const documents = await fetchDocuments(period);

  const data: DocumentData[] = documents.slice(0, 4);

  const profiles = useContext(ProfileContext);

  const t = await getTranslations("Dashboard");

  return (
    <Paper className={classes.container} radius={"md"} w={"100%"} p={"lg"}>
      <Flex direction={"column"} align={"start"} justify={"start"}>
        <Group justify="space-between" w={"100%"}>
          <Text fw={600} size="md" m={0}>
            {t("recent_documents")}
          </Text>
          <CreateDocumentButton variant="default" withIcon={false} />
        </Group>

        <Space h={"xl"} />
        {data &&
          data.map((item, index) => {
            return (
              <UnstyledButton
                key={index}
                // ta="left"
                w="100%"
                pl={4}
                pr={16}
                // onClick={() => {
                //   //   setDoc(item); // Set the document details
                //   //   open(); // Trigger opening a modal or detailed view
                //   console.log("clicked doc");
                // }}
                style={{
                  borderRadius: "8px", // Optional: Add some border radius
                  transition: "background-color 0.2s", // Smooth transition for hover
                }}
                className={classes.item}
              >
                <Flex
                  direction={"column"}
                  justify={"start"}
                  w={"100%"}
                  align={"start"}
                >
                  <Group
                    justify="space-between"
                    w={"100%"}
                    align="center"
                    my={"sm"}
                  >
                    <Flex direction={"column"} ml={"sm"}>
                      <Text size="sm" c={"metal"}>
                        {item.subject}
                      </Text>
                      <Text size="sm" c={"dimmed"}>
                        {`${item.client?.name} / ${item.type} ${item.number}`}
                      </Text>
                    </Flex>

                    <Flex direction={"row"}>
                      <Text ff={"monospace"} px={"sm"} fw={"500"}>
                        {item.settings.currency &&
                          formatTotal(item.total, item.settings.currency)}
                      </Text>
                      <IconChevronRight size={"18px"} />
                    </Flex>
                  </Group>
                </Flex>
              </UnstyledButton>
            );
          })}

        <Button
          mt={"md"}
          variant="outline"
          bd={"transparent"}
          fw={400}
          size="xs"
          component={Link}
          href={`${profiles?.activeProfile?.id}/documents`}
          rightSection={<IconChevronRight size={"18px"} />}
        >
          {t("see_all_documents")}
        </Button>
      </Flex>
    </Paper>
  );
}

export default RecentDocuments;
