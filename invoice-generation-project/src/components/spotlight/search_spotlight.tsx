"use client";
import { createSpotlight, Spotlight } from "@mantine/spotlight";

import { ReactElement, useEffect, useState } from "react";
import { IconFile, IconUser } from "@tabler/icons-react";
import { ClientData, DocumentData } from "@/types";
import { makeGetRequest } from "@/app/api/api";

export const [searchStore, searchSpotlight] = createSpotlight();
type SearchItem = {
  type: string;
  label: string;
  description?: string;
  id: string;
};

const SearchSpotlight: React.FC<any> = () => {
  const [query, setQuery] = useState("");
  const [recentClients, setClients] = useState<ClientData[]>();
  const [recentDocuments, setDocuments] = useState<DocumentData[]>();
  const [todayItems, setTodayItems] = useState<ReactElement[]>([]);
  const [yesterdayItems, setYesterdayItems] = useState<ReactElement[]>([]);
  const [olderItems, setOlderItems] = useState<ReactElement[]>([]);

  useEffect(() => {
    const fetchDocuments = async () => {
      const response = await makeGetRequest("/api/documents");
      const data = response.results;
      if (data.length > 0) {
        setDocuments(data);
      }
    };
    const fetchClients = async () => {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL; // Use the environment variable

      const response = await makeGetRequest(`${baseUrl}/api/clients`);
      const data = response.results;
      if (data.length > 0) {
        setClients(data);
      }
    };
    fetchClients();
    fetchDocuments();
  }, []);

  useEffect(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const getDateKey = (date: Date) => {
      if (!date) {
        return "Older";
      } else if (date.toDateString() === today.toDateString()) {
        return "Today";
      } else if (date.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
      } else {
        return "Older";
      }
    };

    const todayItems: ReactElement[] = [];
    const yesterdayItems: ReactElement[] = [];
    const olderItems: ReactElement[] = [];

    // Adding documents to the combined groups
    if (recentDocuments) {
      recentDocuments.forEach((item, index) => {
        const groupKey = getDateKey(new Date(item.issueDate));

        const action: ReactElement = (
          <Spotlight.Action
            key={item.number}
            id={item.number}
            label={item.subject}
            description={`${item.client!.name} / ${item.type} ${item.number}`}
            onClick={() => {}}
            leftSection={<IconFile />}
          />
        );

        if (groupKey == "Today") {
          todayItems.push(action);
        } else if (groupKey == "Yesterday") {
          yesterdayItems.push(action);
        } else {
          olderItems.push(action);
        }
      });
    }

    // Adding clients to the combined groups
    if (recentClients) {
      recentClients.forEach((item, index) => {
        const groupKey = item.data?.lastContactDate
          ? getDateKey(new Date(item.data.lastContactDate))
          : "Older";

        const action: ReactElement = (
          <Spotlight.Action
            key={item.id}
            id={item.id}
            label={item.name}
            onClick={() => {}}
            leftSection={<IconUser />}
          />
        );

        if (groupKey == "Today") {
          todayItems.push(action);
        } else if (groupKey == "Yesterday") {
          yesterdayItems.push(action);
        } else {
          olderItems.push(action);
        }

        // combinedGroups[groupKey].push({
        //   id: item.id,
        //   label: item.name,
        // });

        // combinedGroups[groupKey].push(
        //   <Spotlight.Action
        //     key={item.id}
        //     id={item.id}
        //     label={item.name}
        //     onClick={() => {}}
        //     leftSection={<IconUser />}
        //   />
        // );
      });
    }

    // Creating the final grouped actions
    // for (const group in combinedGroups) {
    //   if (combinedGroups[group].length > 0) {
    //     actions.push({
    //       group,
    //       actions: combinedGroups[group].slice(0, 7), // Limit to 7 items per group if needed
    //     });
    //   }
    // }

    setTodayItems(todayItems);
    setYesterdayItems(yesterdayItems);
    setOlderItems(olderItems);
  }, [recentDocuments, recentClients]);

  const searchableItems: SearchItem[] = [];

  if (query.length > 0) {
    if (recentClients) {
      searchableItems.push(
        ...recentClients
          .filter((client) =>
            client.name.toLowerCase().includes(query.toLowerCase().trim())
          )
          .map((client) => ({
            type: "client" as const,
            id: client.id!,
            label: client.name,
          }))
      );
    }

    if (recentDocuments) {
      searchableItems.push(
        ...recentDocuments
          .filter((document) =>
            document.subject?.toLowerCase().includes(query.toLowerCase().trim())
          )
          .map((document) => ({
            id: document.number!,
            type: "document" as const,
            label: document.subject ?? document.items[0].name,
            description: `${document.client!.name} / ${document.type} ${
              document.number
            }`,
          }))
      );
    }
  }
  //   [
  //     recentClients?.filter((item) =>
  //       item.name.toLowerCase().includes(query.toLowerCase().trim())
  //     ),
  //     recentDocuments?.filter((item) =>
  //       item.subject.toLowerCase().includes(query.toLowerCase().trim())
  //     ),
  //   ];

  return (
    <Spotlight.Root
      query={query}
      onQueryChange={setQuery}
      store={searchStore}
      maxHeight={"50vh"}
      scrollable
    >
      <Spotlight.Search placeholder="Search for a document" />
      <Spotlight.ActionsList>
        {query.length > 0 &&
          (searchableItems.length > 0 ? (
            searchableItems.map((item, index) => {
              return item.type === "document" ? (
                <Spotlight.Action
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  description={item.description}
                  onClick={() => {}}
                  leftSection={<IconFile />}
                />
              ) : (
                <Spotlight.Action
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  onClick={() => {}}
                  leftSection={<IconUser />}
                />
              );
            })
          ) : (
            <Spotlight.Empty>Nothing found...</Spotlight.Empty>
          ))}
        {query.length == 0 && (
          <>
            <Spotlight.ActionsGroup label="Today">
              {todayItems}
            </Spotlight.ActionsGroup>
            <Spotlight.ActionsGroup label="Yesterday">
              {yesterdayItems}
            </Spotlight.ActionsGroup>
            <Spotlight.ActionsGroup label="Older">
              {olderItems}
            </Spotlight.ActionsGroup>
          </>
        )}
      </Spotlight.ActionsList>
    </Spotlight.Root>
  );
};

export default SearchSpotlight;
