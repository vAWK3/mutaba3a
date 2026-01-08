"use client";

import { ResponsiveSizeAppShell } from "@/components/mainContainer/customAppShell";
import { Box, Button, Container } from "@mantine/core";
import { NextPage } from "next";
import { useSearchParams } from "next/navigation";

import { useContext, useEffect, useState } from "react";

import PageHeader from "@/components/header/pageHeader";
import { IconDownload, IconFilter } from "@tabler/icons-react";
import { useDisclosure } from "@mantine/hooks";

import DocumentsView from "@/app/ui/documents/view";
import { useTranslations } from "next-intl";
import StyledSegmentedControl from "@/components/select/custom_segmented_control";
import ClientDetails from "@/app/ui/clients/details";
import { ClientData, DocumentData, IssuedDocumentType } from "@/types";
import { makeGetRequest } from "@/app/api/api";
import { ProfileContext } from "@/contexts/ProfileContext";

const SingleClientPage: NextPage = () => {
  const params = useSearchParams();

  const [client, setClient] = useState<ClientData>();

  const [withFilters, toggleFilters] = useDisclosure(false);
  const [selectedRecords, setSelectedRecords] = useState<DocumentData[]>([]);
  const [selectedType, setSelectedType] = useState<IssuedDocumentType | "all">(
    IssuedDocumentType.Invoice
  );

  const t = useTranslations("Documents");
  const tb = useTranslations("Buttons");

  const profiles = useContext(ProfileContext);

  useEffect(() => {
    const fetchClient = async () => {
      const response = await makeGetRequest(
        `/api/clients?id=${params?.get("id")}`
      );

      console.log("response is ", response);
      // const data = response.results;
      const data = response;

      console.log("data is ", data);

      setClient(data[0]);
    };

    fetchClient();
  }, [params]);

  return (
    <ResponsiveSizeAppShell
      // lastPath={client && (client.name ?? params?.get("id"))}
      aside={client && <ClientDetails client={client} />} // Position ClientDetails under the header
    >
      <Container fluid>
        <PageHeader
          title={client && client.name}
          subtitle={`${client?.data?.numberOfDocuments ?? 0} ${t("documents")}`}
          buttons={[
            // Conditionally render the Download button
            selectedRecords.length > 0 && (
              <Button
                key="download"
                fw={400}
                color="blue"
                variant="transparent"
                leftSection={<IconDownload />}
                onClick={() => console.log("Download clicked")}
              >
                {tb("download")}
              </Button>
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
          withFilters={withFilters}
          docType={selectedType}
          selectedRecords={selectedRecords}
          setSelectedRecords={setSelectedRecords}
          profileId={profiles?.activeProfile?.id ?? ""}
        />
      </Container>
    </ResponsiveSizeAppShell>
  );
};

export default SingleClientPage;
