"use client";

import classes from "../documents/DocumentTable.module.css";
import { Text } from "@mantine/core";
import { DataTable, DataTableColumn } from "mantine-datatable";

import NameWithAvatar from "../../../components/clients/avatar_name";

import EmptyState from "@/components/empty/empty_state";

import { formatTotal } from "../../../../utilities/formatters";

import { PaginationInfo } from "../../../../models/pagination_info";
import { useTranslations } from "next-intl";
import { ClientData } from "@/types";
import { ProfileContext } from "@/contexts/ProfileContext";
import { useContext } from "react";

export interface ClientDataProps {
  data: ClientData[];
  withFilters: boolean;
  clearFilters: () => void;
  paginationInfo?: PaginationInfo;
  setPage?: (page: number) => void;
}

const ClientsTable = ({
  data,
  withFilters,
  clearFilters,
  paginationInfo,
  setPage,
}: ClientDataProps) => {
  const t = useTranslations("Clients");
  const profiles = useContext(ProfileContext);

  const columns: DataTableColumn<ClientData>[] = [
    {
      accessor: "client",
      title: t("client"),
      titleClassName: classes.header,
      render: ({ name, color }) => (
        <NameWithAvatar name={name} color={color}></NameWithAvatar>
      ),
    },
    {
      accessor: "email",
      title: t("email"),
      titleClassName: classes.header,
      render: ({ email }) => <Text>{email}</Text>,
    },
    {
      accessor: "number",
      title: t("number"),
      titleClassName: classes.header,
      render: ({ refNumber }) => (
        <Text fw={400} ff={"mono"} c={"metal.5"}>
          {refNumber}
        </Text>
      ),
    },
    {
      accessor: "documents",
      title: t("documents"),
      titleClassName: classes.header,
      textAlign: "right",
      render: ({ data }) => <Text>{data?.numberOfDocuments ?? "0"}</Text>,
    },
    {
      accessor: "total",
      title: t("total"),
      titleClassName: classes.header,
      textAlign: "right",
      render: ({ data, document }) => (
        <Text ff={"mono"}>
          {data &&
            document?.currency &&
            formatTotal(data?.outstandingInvoices, document?.currency)}
        </Text>
      ),
    },
    {
      accessor: "documents",
      title: t("documents"),
      titleClassName: classes.header,
      textAlign: "right",
      render: ({ data }) => <Text>{data?.numberOfDocuments}</Text>,
    },
  ];

  const handleRowClick = (record: ClientData) => {
    window.location.href = `${profiles?.activeProfile?.id}/clients/${record.id!}`;
  };

  if (!paginationInfo || !setPage) {
    return <div>Error paginationInfo and setPage</div>;
  }

  return (
    <DataTable
      withTableBorder
      withRowBorders
      className={classes.table}
      rowClassName={classes.row}
      highlightOnHover
      maxHeight={"70vh"}
      idAccessor="number"
      totalRecords={paginationInfo!.maxItems}
      recordsPerPage={paginationInfo!.itemsPerPage}
      page={paginationInfo!.page}
      onPageChange={setPage!}
      paginationSize="sm"
      paginationText={({ from, to, totalRecords }) => {
        return (
          <Text>
            {t("pagination", {
              from: from.toString(),
              to: to.toString(),
              totalRecords: totalRecords.toString(),
            })}
          </Text>
        );
      }}
      paginationActiveBackgroundColor="blue"
      paginationActiveTextColor="metal"
      selectionTrigger="cell"
      records={data}
      columns={columns}
      style={{
        minHeight: data.length === 0 ? "500px" : "auto", // Adjust the height when empty
      }}
      emptyState={
        <EmptyState
          forDocuments={false}
          withFilters={withFilters}
          onButtonTap={clearFilters}
        />
      }
      onRowClick={(e) => handleRowClick(e.record)}
    />
  );
};

export default ClientsTable;
