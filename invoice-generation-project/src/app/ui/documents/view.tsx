import {
  Flex,
  TextInput,
  Space,
  Group,
  MultiSelect,
  Box,
  Loader,
} from "@mantine/core";
import { DatePicker, DatePickerInput, DatesRangeValue } from "@mantine/dates";
import "@mantine/dates/styles.css";
import {
  IconX,
  IconSearch,
  IconUsers,
  IconCalendarWeek,
  IconCircleDot,
} from "@tabler/icons-react";
import { DocumentData, DocumentStatus } from "@/types";

import { formatDatesRange } from "../../../../utilities/formatters";
import { useDebouncedValue } from "@mantine/hooks";
import { useState, useMemo, useEffect, SetStateAction } from "react";
import { IssuedDocumentType } from "@/types";
import { useTranslations } from "next-intl";
import { isDateInRange } from "../../../../utilities/checkers";
import DocumentsTable from "./table";
import DocumentsGrid from "./grid";
import { makeGetRequest } from "@/app/api/api";

const PAGE_SIZE = 20;

interface DocumentsViewProps {
  profileId: string | number;
  withFilters: boolean;
  initialStatus?: string;
  docType?: IssuedDocumentType | "all";
  selectedRecords: DocumentData[];
  setSelectedRecords: React.Dispatch<React.SetStateAction<DocumentData[]>>;
  clientId?: string;
}

const DocumentsView = ({
  profileId,
  clientId,
  withFilters,
  initialStatus,
  docType,
  selectedRecords,
  setSelectedRecords,
}: DocumentsViewProps) => {
  const t = useTranslations("Documents");

  const statusOptions = Object.values(DocumentStatus).map((status) => ({
    value: status,
    label: t(status), // Use the translation for each status
  }));

  // get data
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [isLoading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState(1);
  const [{ fromItem, toItem }, setItem] = useState({
    fromItem: 0,
    toItem: PAGE_SIZE,
  });


  useEffect(() => {

    makeGetRequest(`/api/documents/${profileId}/${clientId != undefined ? `?client=${clientId}` : ""}`)
      .then((data) => {
        setLoading(false);
        if (data.results) {
          setDocuments(data.results);
        }
      })
      .catch((err) => {
        setLoading(false);
        console.error("Error fetching profiles:", err);
      });

  }, [profileId, clientId]);

  // apply client filter
  const clients = useMemo(() => {
    const clients = new Set(documents.map((e) => e.client!.name));
    return [...clients];
  }, [documents]);

  const [query, setQuery] = useState("");
  const [selectedClients, setClients] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>(
    initialStatus === undefined ? [] : [initialStatus]
  );
  const [timelineRange, setTimeline] = useState<DatesRangeValue>();
  const [debouncedQuery] = useDebouncedValue(query, 200);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    setQuery(value);
  };

  const [isSafari, setIsSafari] = useState(false);

  useEffect(() => {
    const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(
      navigator.userAgent
    );
    setIsSafari(isSafariBrowser);
  }, []);

  useEffect(() => {
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE;

    setItem({
      fromItem: from,
      toItem: to,
    });
  }, [page]);

  useEffect(() => {
    setPage(1);
  }, [query, docType, timelineRange, selectedClients, statusFilter]);

  const clearFilters = () => {
    setClients([]);
    setStatusFilter([]);
    setTimeline(undefined);
    setQuery("");
  };

  const records = filterData(
    documents,
    debouncedQuery,
    statusFilter,
    selectedClients,
    timelineRange,
    docType
  ).slice(fromItem, toItem);

  const dates = formatDatesRange(timelineRange);

  return (
    <Flex direction="column">
      {withFilters && (
        <Flex direction="row" py={"xs"}>
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
          <Space w={"md"} />
          <Group align="start">
            <DatePickerInput
              leftSection={<IconCalendarWeek size={16} />}
              leftSectionPointerEvents="none"
              modalProps={{
                dir: "ltr",
              }}
              clearable
              type="range"
              placeholder={t("timeline_ph")}
              maxDate={new Date()}
              value={timelineRange}
              onChange={setTimeline}
            />
            <MultiSelect
              hidePickedOptions
              leftSection={<IconUsers size={16} />}
              leftSectionPointerEvents="none"
              placeholder={
                selectedClients && selectedClients.length > 0
                  ? undefined
                  : t("clients")
              }
              w={isSafari ? "12vw" : undefined}
              data={clients}
              onChange={setClients}
            />
            <MultiSelect
              hidePickedOptions
              leftSection={<IconCircleDot size={16} />}
              leftSectionPointerEvents="none"
              placeholder={
                statusFilter && statusFilter.length > 0
                  ? undefined
                  : t("status")
              }
              value={statusFilter}
              onChange={setStatusFilter}
              data={statusOptions} // Use the translated options here
              w={isSafari ? "12vw" : undefined}
            />

            {/* <Popover
              onOpen={() => {
                setTimeline(undefined);
              }}
            >
              <Popover.Target>
                <Button
                  fw={400}
                  c={
                    timelineRange && timelineRange.length > 0
                      ? "metal.9"
                      : "metal.1"
                  }
                  rightSection={
                    timelineRange ? (
                      <IconX size={12} />
                    ) : (
                      <IconChevronDown size={16} />
                    )
                  }
                  variant="default"
                >
                  {dates.length == 0
                    ? t("timeline_ph")
                    : t("timeline", {
                        from: dates[0],
                        to: dates[1],
                      })}
                </Button>
              </Popover.Target>
              <Popover.Dropdown>
                <DatePicker
                  maxDate={new Date()}
                  type="range"
                  value={timelineRange}
                  onChange={setTimeline}
                />
              </Popover.Dropdown>
            </Popover> */}
          </Group>
        </Flex>
      )}
      {!isLoading && (
        <>
          <Box visibleFrom="sm">
            <DocumentsTable
              data={records}
              withFilters={withFilters}
              clearFilters={clearFilters}
              paginationInfo={{
                page: page,
                itemsPerPage: PAGE_SIZE,
                maxItems: documents.length,
              }}
              setPage={(p) => {
                if (records.length >= PAGE_SIZE) {
                  setPage(p);
                }
              }}
              selectedRecords={selectedRecords}
              setSelectedRecords={setSelectedRecords}
            />
          </Box>
          <Box hiddenFrom="sm">
            <DocumentsGrid
              data={records}
              withFilters={withFilters}
              clearFilters={clearFilters}
              selectedRecords={selectedRecords}
              setSelectedRecords={setSelectedRecords}
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

function filterData(
  data: DocumentData[],
  search: string,
  statusFilter: string[],
  clients: string[],
  dates?: DatesRangeValue,
  selectedType?: IssuedDocumentType | "all"
) {
  const query = search.toLowerCase().trim();
  return data.filter((item) => {
    if (selectedType !== "all" && item.type !== selectedType) {
      return false;
    }

    if (query !== "") {
      if (
        !`${item.subject} ${item.client!.name} ${item.number}`
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
    }

    if (statusFilter.length > 0 && !statusFilter.includes(item.status!)) {
      return false;
    }

    if (clients.length && !clients.includes(item.client!.name)) {
      return false;
    }

    if (
      dates &&
      dates[0] &&
      dates[1] &&
      !isDateInRange(dates, item.issueDate)
    ) {
      return false;
    }

    return true;
  });
}

export default DocumentsView;
