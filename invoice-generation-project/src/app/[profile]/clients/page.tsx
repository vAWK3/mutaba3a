"use client";

import PageHeader from "@/components/header/pageHeader";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { Button, Container } from "@mantine/core";

import { ResponsiveSizeAppShell } from "@/components/mainContainer/customAppShell";
import { useDisclosure } from "@mantine/hooks";
import { NextPage } from "next";
import { useTranslations } from "next-intl";

import ClientsView from "../../ui/clients/view";
import Link from "next/link";
import { useContext } from "react";
import { ProfileContext } from "@/contexts/ProfileContext";
import useNavigateToPage from "../../../../utilities/navigation";

// Inside your Documents component
const Clients = ({ params }: {
  params: {
    business: string;
  }
}) => {
  const [withFilters, toggleFilters] = useDisclosure(false);

  const { navigateToPage } = useNavigateToPage();

  const t = useTranslations("Clients");
  const tb = useTranslations("Buttons");

  return (
    <ResponsiveSizeAppShell>
      <Container fluid>
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          buttons={[

            <Button
              key="search"
              variant="default"
              size="sm"
              fw={"400"}
              leftSection={<IconSearch size={16} />}
              onClick={toggleFilters.toggle}
            >
              {tb("search")}
            </Button>,
            <Button
              key="new_client"
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => navigateToPage('clients_new')}
            >
              {tb("new_client")}
            </Button>,
          ]}
        />

        <ClientsView withFilters={withFilters} profileId={params.business} />
      </Container>
    </ResponsiveSizeAppShell>
  );
};

export default Clients;
