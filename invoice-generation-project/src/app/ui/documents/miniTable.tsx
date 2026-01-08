"use client";

import { useContext, useEffect, useState } from "react";
import {
  Paper,
  Text,
  Flex,
  Space,
  Group,
  Button,
  useDirection,
  PaperProps,
} from "@mantine/core";
import { DataTable, DataTableColumn } from "mantine-datatable";
import StatusTag from "@/components/tags/statusTag";
import {
  Currency,
  DocumentData,
  IssuedDocumentType,
} from "@/types";
import { formatDate, formatTotal } from "../../../../utilities/formatters";
import { useTranslations } from "next-intl";
import classes from "../documents/DocumentTable.module.css"; // Assuming styles are defined here
import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { ModalType, useModal } from "@/contexts/ModalContext";
import CreateDocumentButton from "@/components/buttons/create_document_button";
import { RecentDocumentSkeleton } from "../skeletons/recent_doc";
import { makeGetRequest } from "@/app/api/api";
import { ProfileContext } from "@/contexts/ProfileContext";

interface SimpleDocumentsTableProps extends PaperProps {
  profileId: string;
  currency: Currency;
}
const headerClass = classes.miniheader;

const SimpleDocumentsTable = ({
  profileId,
  currency,
  ...props
}: SimpleDocumentsTableProps) => {
  const [data, setData] = useState<DocumentData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const t = useTranslations("Documents");
  const td = useTranslations("Dashboard");
  // const profiles = useContext(ProfileContext);
  const { openModal } = useModal();


  //TODO: Remove
  if (!profileId) {
    profileId = '2';
  }

  useEffect(() => {

    makeGetRequest(`/api/documents/${profileId}?recent=true`)
      .then((data) => {
        setLoading(false);
        if (data.results) {
          setData(data.results);
        }
      })
      .catch((err) => {
        setLoading(false);
        console.error("Error fetching documents:", err);
      });

  }, [profileId]);

  const columns: DataTableColumn<DocumentData>[] = [
    {
      accessor: "Invoice",
      title: t("invoice"),
      titleClassName: headerClass,
      render: ({ subject, client }) => (
        <div>
          <Text fw={500} fz={"sm"}>
            {subject}
          </Text>
          <Text size="sm" c={"dimmed"}>
            {client?.name ?? ""}
          </Text>
        </div>
      ),
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

      render: ({ status, dueDate, paidDate }) => {
        if (status) {
          return (
            <StatusTag status={status} dueDate={dueDate} paidDate={paidDate} />
          );
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
          {formatTotal(total, currency)}
        </Text>
      ),
    },
  ];

  const handleRowClick = (record: DocumentData) => {
    openModal(ModalType.Document, {
      document: record,
    });
  };

  return (
    <Paper className={classes.container} radius="md" w="100%" p="lg" {...props}>
      <Flex direction="column" justify="start">
        <Group justify="space-between" w="100%">
          <Text fw={500} size="lg">
            {td("recent_documents")}
          </Text>
          <CreateDocumentButton variant="default" withIcon={false} />
        </Group>
        <Space h="lg" />

        {loading ? (
          // Render skeleton placeholders while loading
          <div>
            <RecentDocumentSkeleton key={1} />
            <RecentDocumentSkeleton key={2} />
            <RecentDocumentSkeleton key={3} />
            <RecentDocumentSkeleton key={4} />
            <RecentDocumentSkeleton key={5} />
          </div>
        ) : (
          // Render the data table once loading is complete
          <DataTable
            withTableBorder
            withRowBorders
            highlightOnHover
            mih={300}
            records={data}
            columns={columns}
            fetching={loading}
            onRowClick={(e) => handleRowClick(e.record)}
            emptyState={<Text>{t('no_recent_documents')}</Text>}
            rowClassName={classes.minirow} // Apply custom row class
          />
        )}

        <Flex justify="flex-end" w="100%">
          <Button
            mt={"md"}
            variant="outline"
            bd={"transparent"}
            fw={400}
            size="md"
            component={Link}
            href={`${profileId}/documents`}
          >
            {td("see_all_documents")}
            <IconChevronLeft size={"18px"} className="ltr:hidden" />
            <IconChevronRight size={"18px"} className="rtl:hidden" />
          </Button>
        </Flex>
      </Flex>
    </Paper>
  );
};

export default SimpleDocumentsTable;
