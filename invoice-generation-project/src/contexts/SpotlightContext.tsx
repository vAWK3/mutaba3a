"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createSpotlight,
  Spotlight,
  SpotlightAction,
  SpotlightActionsGroup,
  SpotlightActionsList,
  SpotlightEmpty,
  SpotlightSearch,
} from "@mantine/spotlight";
import {
  IconCheck,
  IconPencilPlus,
  IconSearch,
  IconUserPlus,
} from "@tabler/icons-react";
import { NewDocumentType } from "@/types";
import { ClientData } from "@/types";
import NameWithAvatar from "@/components/clients/avatar_name";
import { Divider, Group, Button } from "@mantine/core";
import { makeGetRequest } from "@/app/api/api";
import useNavigateToPage from "../../utilities/navigation";
import { ProfileContext } from "./ProfileContext";

export const [clientStore, clientSpotlight] = createSpotlight();

// Define the context
const SpotlightContext = createContext({
  openSpotlight: (document: NewDocumentType, modalProps?: any) => { },
  closeSpotlight: () => { },
});

// Modal provider
export const ClientSpotlightProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [type, setType] = useState<NewDocumentType | null>(null);
  const [props, setProps] = useState<any>({});
  const { navigateToPage } = useNavigateToPage();

  const t = useTranslations("Spotlight");
  const td = useTranslations("Documents");
  const tb = useTranslations("Buttons");

  const openSpotlight = (type: NewDocumentType, props: any = {}) => {
    setType(type);
    setProps(props);
    clientSpotlight.open();
  };

  const closeSpotlight = () => {
    clientSpotlight.close();
    setType(null);
    setProps({});
    setQuery("");
    setSelectedClient(null);
  };

  const profiles = useContext(ProfileContext);

  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<
    ClientData | undefined | null
  >();
  const [recentClients, setRecentClients] = useState<ClientData[]>([]);

  useEffect(() => {
    //TODO: update profile id
    const fetchClients = async () => {
      const response = await makeGetRequest("/api/clients/2");

      const data = response.results;

      console.log('data is ', data);

      console.log('response is ', response);

      setRecentClients(data.clients);
    };
    fetchClients();
  }, []);



  const clients = recentClients
    .filter((item) =>
      item.name.toLowerCase().includes(query.toLowerCase().trim())
    )
    .slice(0, 7)
    .map((client) => (
      // clients.unshift(
      <Spotlight.Action
        py={"xs"}
        key={client.id}
        id={client.id}
        label={client.name}
        onClick={() => {
          setSelectedClient(client);
        }}
        rightSection={
          selectedClient && client.id == selectedClient.id ? (
            <IconCheck />
          ) : (
            <></>
          )
        }
        leftSection={
          <NameWithAvatar
            color={client.color}
            name={client.name}
            withName={false}
          />
        }
      />
    ));

  return (
    <SpotlightContext.Provider value={{ openSpotlight, closeSpotlight }}>
      {children}
      <Spotlight.Root
        query={query}
        onQueryChange={setQuery}
        store={clientStore}
        radius={"sm"}
        size={"lg"}
        p={"xl"}
        clearQueryOnClose={false}
        closeOnActionTrigger={false}
      >
        <SpotlightSearch
          placeholder={t("select_search_client")}
          leftSection={<IconSearch />}
        />
        <SpotlightActionsList>
          {clients.length > 0 ? (
            <SpotlightActionsGroup key="clients" label={t("invoice_to")}>
              {clients}
            </SpotlightActionsGroup>
          ) : (
            <SpotlightEmpty ta={"start"}>
              <SpotlightActionsGroup label={t("actions")}>
                <SpotlightAction
                  key={"empty"}
                  id="empty"
                  label={t("create_client", {
                    name: query,
                  })}
                  leftSection={<IconUserPlus />}
                  onClick={() => {
                    window.location.href = `${profiles?.activeProfile?.id}/clients/new`;
                    closeSpotlight();
                  }}
                />
              </SpotlightActionsGroup>
            </SpotlightEmpty>
          )}
          {selectedClient && (
            <SpotlightAction key={"footer"}>
              <Divider />
              <Group w={"100%"} justify="space-between">
                <Button variant="default" fw={400} onClick={closeSpotlight}>
                  {tb("cancel")}
                </Button>
                <Button
                  onClick={() => {
                    if (!selectedClient) {
                      return;
                    }
                    navigateToPage('documents', {
                      type: type,
                      id: selectedClient.id,
                      client: selectedClient.name,
                    });
                    // window.location.href = `/documents/new?type=${type}&id=${selectedClient.id}&client=${selectedClient.name}`;
                    closeSpotlight();
                  }}
                  leftSection={<IconPencilPlus strokeWidth={1.5} />}
                >
                  {t("create_document", {
                    type: td(`${type}`),
                  })}
                </Button>
              </Group>
            </SpotlightAction>
          )}
        </SpotlightActionsList>
      </Spotlight.Root>
    </SpotlightContext.Provider>
  );
};

export const useClientSpotlight = () => useContext(SpotlightContext);
