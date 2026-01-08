import { Flex, TextInput, Box, Loader } from "@mantine/core";
import { IconX, IconSearch } from "@tabler/icons-react";
import { useDebouncedValue } from "@mantine/hooks";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import ClientsTable from "./table";
import ClientsGrid from "./grid";
import { ClientData } from "@/types";
import { makeGetRequest } from "@/app/api/api";

const PAGE_SIZE = 20;

interface ClientsViewProps {
  withFilters: boolean;
  profileId: string;
}

const DocumentsView = ({ withFilters, profileId }: ClientsViewProps) => {
  const t = useTranslations("Clients");

  // get data
  const [clients, setClients] = useState<ClientData[]>([]);
  const [isLoading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState(1);
  const [{ fromItem, toItem }, setItem] = useState({
    fromItem: 0,
    toItem: PAGE_SIZE,
  });
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    setQuery(value);
  };
  const clearFilters = () => setQuery("");

  useEffect(() => {
    makeGetRequest(`/api/clients/${profileId}`)
      .then((data) => {
        setLoading(false);
        if (data.results) {
          setClients(data.results);
        }
      })
      .catch((err) => {
        setLoading(false);
        console.error("Error fetching profiles:", err);
      });
  }, [profileId]);

  useEffect(() => {
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE;

    setItem({
      fromItem: from,
      toItem: to,
    });
  }, [page]);

  useEffect(() => setPage(1), [query]);

  const records = filterData(clients, debouncedQuery).slice(fromItem, toItem);

  return (
    <Flex direction="column">
      {withFilters && (
        <Flex direction="row" className="border-t border-l border-r" p={"md"}>
          <TextInput
            rightSection={
              query !== "" ? (
                <IconX
                  onClick={() => {
                    setQuery("");
                  }}
                />
              ) : null
            }
            leftSection={<IconSearch size={16} />}
            placeholder={t("search_ph")}
            value={query}
            onChange={handleSearchChange}
            style={{ flex: 1 }}
          />
        </Flex>
      )}
      {!isLoading && (
        <>
          <Box visibleFrom="sm">
            <ClientsTable
              data={records}
              withFilters={withFilters}
              clearFilters={clearFilters}
              paginationInfo={{
                page: page,
                itemsPerPage: PAGE_SIZE,
                maxItems: clients.length,
              }}
              setPage={(p) => {
                if (records.length >= PAGE_SIZE) {
                  setPage(p);
                }
              }}
            />
          </Box>
          <Box hiddenFrom="sm">
            <ClientsGrid
              data={records}
              withFilters={withFilters}
              clearFilters={clearFilters}
            />
          </Box>
        </>
      )}
      {isLoading && (
        <Flex
          direction={"column"}
          align={"center"}
          justify={"center"}
          h={"50vh"}
        >
          <Loader />
        </Flex>
      )}
    </Flex>
  );
};

function filterData(data: ClientData[], search: string) {
  const query = search.toLowerCase().trim();
  if (!data) { return []; }
  return data.filter((item) => {
    if (query !== "") {
      if (
        !`${item.name}  ${item.address.address1Ar ?? ""} ${item.address.address1En ?? ""
          } ${item.address.address1He ?? ""} ${item.id} ${item.phoneNumber ?? ""}`
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
    }

    return true;
  });
}

export default DocumentsView;
