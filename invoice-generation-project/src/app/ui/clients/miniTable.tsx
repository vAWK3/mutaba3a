"use client";

import { useContext, useEffect, useState } from "react";
import {
  Paper,
  Text,
  Flex,
  Space,
  Group,
  Button,
  Skeleton,
  useDirection,
  PaperProps,
} from "@mantine/core";
import { DataTable, DataTableColumn } from "mantine-datatable";
import { ClientData } from "@/types";
import { useTranslations } from "next-intl";
import classes from "../documents/DocumentTable.module.css";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import ClientRow from "../dashboard/client_row";
import { makeGetRequest } from "@/app/api/api";
import { ProfileContext } from "@/contexts/ProfileContext";

interface SimpleClientsTableProps extends PaperProps {
  profileId: string;
}

const SimpleClientsTable = ({ profileId, ...props }: SimpleClientsTableProps) => {
  const [data, setData] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const t = useTranslations("Clients");
  const tc = useTranslations("Buttons");
  const td = useTranslations("Dashboard");
  const { dir } = useDirection(); // Get the current direction

  const profiles = useContext(ProfileContext);

  useEffect(() => {

    makeGetRequest(`/api/clients/${profileId}?recent=true`)
      .then((data) => {
        setLoading(false);
        if (data.results) {
          setData(data.results);
        }
      })
      .catch((err) => {
        setLoading(false);
        console.error("Error fetching profiles:", err);
      });
  }, [profileId]);

  const columns: DataTableColumn<ClientData>[] = [
    {
      accessor: "client",
      title: t("client"),
      titleClassName: classes.miniheader,
      render: (record) => (
        <ClientRow
          client={record}
          withTotal={false}
          documentLabel={t("documents")}
        />
      ),
    },
    {
      accessor: "email",
      title: t("email"),
      titleClassName: classes.miniheader,
      render: ({ email }) => <Text>{email}</Text>,
    },
  ];


  const handleRowClick = (record: ClientData) => {
    window.location.href = `${profiles?.activeProfile?.id}/clients/${record.id!}`;
  };

  return (
    <Paper className={classes.container} radius="md" w="100%" p="lg" {...props}>
      <Flex direction="column" justify="start">
        <Group justify="space-between" w="100%">
          <Text fw={500} size="lg">
            {td("recent_clients")}
          </Text>
          <Button
            variant="default"
            title="New client"
            component={Link}
            href={`${profiles?.activeProfile?.id}/clients/new`}
          >
            {tc("new_client")}
          </Button>
        </Group>
        <Space h="lg" />

        {loading ? (
          // Render skeleton placeholders while loading
          <>
            {Array(5)
              .fill(0)
              .map((_, index) => (
                <Group key={index} align="center" gap="sm" mb={20}>
                  {/* Skeleton for Client Name and Avatar */}
                  <Skeleton height={30} width={30} radius="xl" />

                  <div style={{ flex: 3 }}>
                    {/* Short skeleton for title */}
                    <Skeleton height={12} mb={6} radius="sm" />

                    {/* Longer skeleton for subtitle */}
                    <Skeleton height={12} radius="sm" />
                  </div>
                  {/* Skeleton for Email */}
                  <Skeleton height={30} radius="sm" flex={6} />
                </Group>
              ))}
          </>
        ) : (
          <DataTable
            withTableBorder
            withRowBorders
            highlightOnHover
            records={data}
            columns={columns}
            fetching={loading}
            onRowClick={(e) => handleRowClick(e.record)}
            mih={300}
            emptyState={<Text>{t('no_recent_clients')}</Text>}
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
            href={`${profiles?.activeProfile?.id}/clients`}
          >
            {td("see_all_clients")}
            <IconChevronLeft size={"18px"} className="ltr:hidden" />
            <IconChevronRight size={"18px"} className="rtl:hidden" />
          </Button>
        </Flex>
      </Flex>
    </Paper>
  );
};

export default SimpleClientsTable;
