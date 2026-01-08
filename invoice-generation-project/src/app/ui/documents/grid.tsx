"use client";
//TODO: implement infinite scroll pagination

import { Group, Center, Divider, Text, Flex } from "@mantine/core";

import GridItem from "@/components/grid/grid_item";
import StatusTag from "@/components/tags/statusTag";
import { formatDate, formatTotal } from "../../../../utilities/formatters";

import EmptyState from "@/components/empty/empty_state";
import { DocumentDataProps } from "./table";
import { useTranslations } from "next-intl";
import { ModalType, useModal } from "@/contexts/ModalContext";
import { EqualResponsiveGrid } from "@/components/grid/equal_responsive_grid";
import DocumentActions from "./actions";
import { DocumentData } from "@/types";

//TODO: make selectable on tap

const DocumentsGrid = ({
  data,
  withFilters,
  clearFilters,
  selectedRecords,
  setSelectedRecords,
}: DocumentDataProps) => {
  const { openModal } = useModal();

  if (data.length <= 0) {
    return (
      <Center h={"50vh"}>
        <EmptyState
          forDocuments={true}
          withFilters={withFilters}
          onButtonTap={() => {
            clearFilters();
          }}
        />
      </Center>
    );
  }

  return (
    <EqualResponsiveGrid desktopSpan={6} mobileSpan={12}>
      {data.map((record, index) => (
        <div key={index}>
          <DocumentGridItem
            document={record}
            onClick={() => {
              openModal(ModalType.Document, {
                document: record,
              });
            }}
          />
        </div>
      ))}
    </EqualResponsiveGrid>
  );
};

interface GridItemProps {
  document: DocumentData;
  onClick: () => void;
}

const DocumentGridItem = ({ document, onClick }: GridItemProps) => {
  const t = useTranslations("Documents");
  return (
    <GridItem onClick={onClick}>
      <Group justify="space-between" style={{ marginBottom: "16px" }}>
        <Text fw={400} fz={"xs"}>{`${document.type} ${document.number}`}</Text>
        <StatusTag status={document.status!} size="xs" />
      </Group>
      <Flex direction={"row"} justify={"space-between"} align={"center"}>
        <Flex direction={"column"}>
          <Text fw={500} fz={"md"}>
            {document.subject}
          </Text>
          <Text fw={400} fz={"sm"}>
            {document.client!.name}
          </Text>
        </Flex>
        <DocumentActions document={document} />
      </Flex>
      <Divider mt={"md"} mb={"md"} />
      <EqualResponsiveGrid mobileSpan={6} desktopSpan={6}>
        <Flex direction={"column"}>
          <Text fw={400} fz={"sm"} c={"metal.6"}>
            {t("issue_date")}
          </Text>
          <Text fw={500} fz={"sm"}>
            {formatDate(document.issueDate)}
          </Text>
        </Flex>
        <Flex direction={"column"}>
          <Text fw={400} fz={"sm"} c={"metal.6"}>
            {t("due_date")}
          </Text>
          <Text fw={500} fz={"sm"}>
            {formatDate(document.issueDate)}
          </Text>
        </Flex>
        <Flex direction={"column"}>
          <Text fw={400} fz={"sm"} c={"metal.6"}>
            {t("subtotal")}
          </Text>
          <Text fw={500} fz={"sm"}>
            {formatTotal(document.total, document.settings.currency!)}
          </Text>
        </Flex>
        <Flex direction={"column"}>
          <Text fw={400} fz={"sm"} c={"metal.6"}>
            {t("total")}
          </Text>
          <Text fw={500} fz={"sm"}>
            {formatTotal(document.total, document.settings.currency!)}
          </Text>
        </Flex>
      </EqualResponsiveGrid>
      {/* <Grid>
        <GridCol span={6}></GridCol>
        <GridCol span={6}></GridCol>
        <GridCol span={6}></GridCol>
        <GridCol span={6}></GridCol>
      </Grid> */}
    </GridItem>
  );
};

export default DocumentsGrid;
