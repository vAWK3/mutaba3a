"use client";

import classes from "./DocumentTable.module.css";
import { Text } from "@mantine/core";
import { DataTable, DataTableColumn } from "mantine-datatable";

import NameWithAvatar from "../../../components/clients/avatar_name";
import EmptyState from "@/components/empty/empty_state";
import StatusTag from "@/components/tags/statusTag";
import { Currency, DocumentData } from "@/types";

import { formatDate, formatTotal } from "../../../../utilities/formatters";

import { PaginationInfo } from "../../../../models/pagination_info";
import { useTranslations } from "next-intl";
import { ModalType, useModal } from "@/contexts/ModalContext";
import DocumentActions from "./actions";

export interface DocumentDataProps {
  data: DocumentData[];
  withFilters: boolean;
  clearFilters: () => void;
  paginationInfo?: PaginationInfo;
  setPage?: (page: number) => void;
  selectedRecords: DocumentData[];
  setSelectedRecords: React.Dispatch<React.SetStateAction<DocumentData[]>>;
}

const DocumentsTable = ({
  data,
  withFilters,
  clearFilters,
  paginationInfo,
  setPage,
  selectedRecords,
  setSelectedRecords,
}: DocumentDataProps) => {
  const t = useTranslations("Documents");
  const { openModal } = useModal();

  const minHeight = data.length === 0 ? "200px" : "auto";

  const totalAmount = data.reduce(
    (sum, record) => sum + Number(record.total),
    0
  );

  const headerClass = classes.header;

  const columns: DataTableColumn<DocumentData>[] = [
    {
      accessor: "subject",
      title: t("subject"),
      titleClassName: headerClass,
      render: (record) => <Text fw={500}>{record.subject}</Text>,
      footer: <Text fw={500}>{t("total")}</Text>,
    },
    {
      accessor: "client",
      title: t("client"),
      titleClassName: headerClass,
      render: ({ client }) => (
        <NameWithAvatar
          name={client?.name ?? ""}
          color={client?.color}
        ></NameWithAvatar>
      ),
    },
    {
      accessor: "issueDate",
      title: t("issue_date"),
      titleClassName: headerClass,
      textAlign: "left",
      render: ({ issueDate }) => (
        <Text ff={"monospace"}>{formatDate(issueDate)}</Text>
      ),
    },

    {
      accessor: "type",
      title: t("type"),
      titleClassName: headerClass,
      render: ({ type }) => <Text fw={500}>{t(`${type}`)}</Text>,
    },
    {
      accessor: "number",
      title: t("number"),
      titleClassName: headerClass,
      render: (record) => (
        <Text fw={400} ff={"mono"} c={"metal.5"}>
          {record.number}
        </Text>
      ),
    },

    {
      accessor: "status",
      title: t("status"),
      titleClassName: headerClass,
      textAlign: "left",
      render: ({ status, dueDate, paidDate }) => {
        if (status) {
          return <StatusTag status={status} dueDate={dueDate} paidDate={paidDate} />;
        }
    
        return <div></div>;
      },
    },
    {
      accessor: "total",
      title: t("total"),
      titleClassName: headerClass,
      textAlign: "right",
      render: ({ total }) => (
        <Text ff={"mono"} fw={500}>
          {formatTotal(total, Currency.Dollar)}
        </Text>
      ),
      footer: (
        <Text ff={"mono"} fw={500} ta={"right"}>
          {formatTotal(totalAmount, Currency.Dollar)}
        </Text>
      ),
    },
    // {
    //   accessor: "status",
    //   title: t("status"),
    //   titleClassName: headerClass,
    //   textAlign: "left",
    //   render: ({ status }) => <StatusTag status={status!} />,
    // },

    {
      accessor: "actions",
      title: t("actions"),
      titleClassName: headerClass,
      textAlign: "right",
      render: (document) => <DocumentActions document={document} />,
    },
  ];

  const handleRowClick = (record: DocumentData) => {
    openModal(ModalType.Document, {
      document: record,
    });
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
      selectedRecords={selectedRecords}
      onSelectedRecordsChange={setSelectedRecords}
      selectionTrigger="cell"
      records={data}
      columns={columns}
      styles={{
        header: {
          backgroundColor:
            "light-dark(var(--mantine-color-metal-0), var(--mantine-color-dark-8))",
        },
      }}
      style={{
        minHeight: data.length === 0 ? "500px" : "auto", // Adjust the height when empty
      }}
      emptyState={
        <EmptyState
          forDocuments={true}
          withFilters={withFilters}
          onButtonTap={clearFilters}
        />
      }
      onRowClick={(e) => handleRowClick(e.record)}
    />
  );
};

export default DocumentsTable;
