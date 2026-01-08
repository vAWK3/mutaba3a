"use client";

import { useState } from "react";
import PageHeader from "@/components/header/pageHeader";
import { IconDownload, IconFilter } from "@tabler/icons-react";
import {
  ActionIcon,
  Box,
  Button,
  Container,

  Tooltip,
} from "@mantine/core";
import { DocumentData, IssuedDocumentType } from "@/types";

import { ResponsiveSizeAppShell } from "@/components/mainContainer/customAppShell";
import { useDisclosure } from "@mantine/hooks";
import StyledSegmentedControl from "@/components/select/custom_segmented_control"; // Import the reusable segmented control
import { NextPage } from "next";
import { useTranslations } from "next-intl";
import DocumentsView from "../../ui/documents/view";

// Inside your Documents component
const Page = ({ params }: {
  params: {
    id: string
  };
}) => {
  const [withFilters, toggleFilters] = useDisclosure(false);
  const [selectedRecords, setSelectedRecords] = useState<DocumentData[]>([]);
  const [selectedType, setSelectedType] = useState<IssuedDocumentType | "all">(
    IssuedDocumentType.Invoice
  );

  const t = useTranslations("Documents");
  const tb = useTranslations("Buttons");

  console.log('****\n\n\n\n\n\n\n\nid is ', params.id);

  return (
    <ResponsiveSizeAppShell>
      <Container fluid>
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          buttons={[
            // Conditionally render the Download button
            selectedRecords.length > 0 && (
              <Tooltip label={tb("download")}>
                <ActionIcon
                  size="lg"
                  key="download"
                  fw={400}
                  color="blue"
                  variant="light"
                  onClick={() => console.log("Download clicked")}
                >
                  <IconDownload />
                </ActionIcon>
              </Tooltip>
            ),
            <Box visibleFrom="sm" key="filters">
              <Button
                variant="default"
                size="sm"
                fw={"400"}
                leftSection={<IconFilter size={16} />}
                onClick={toggleFilters.toggle}
              >
                {tb("filters")}
              </Button>
            </Box>,
          ]}
        />

        <StyledSegmentedControl
          value={selectedType}
          mb={16}
          onChange={(value) =>
            setSelectedType(value as IssuedDocumentType | "all")
          }
          data={[
            { value: "all", label: t("all") },
            ...Object.values(IssuedDocumentType).map((type) => ({
              value: type,
              label: t(`${type}`),
            })),
          ]}
          queryTerm={"type"}
          defaultValue={IssuedDocumentType.Invoice}
        />

        <DocumentsView
          profileId={params.id}
          withFilters={withFilters}
          docType={selectedType}
          selectedRecords={selectedRecords}
          setSelectedRecords={setSelectedRecords}
        />
      </Container>
    </ResponsiveSizeAppShell>
  );
};

export default Page;
