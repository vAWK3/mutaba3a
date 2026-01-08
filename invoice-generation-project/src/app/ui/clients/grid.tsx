"use client";
//TODO: implement infinite scroll pagination

import { Center, Divider, Text, Flex, Grid, GridCol } from "@mantine/core";
import GridItem from "@/components/grid/grid_item";

import { formatTotal } from "../../../../utilities/formatters";

import EmptyState from "@/components/empty/empty_state";

import { EqualResponsiveGrid } from "@/components/grid/equal_responsive_grid";

import { ClientDataProps } from "./table";
import { ClientData } from "@/types";
import NameWithAvatar from "@/components/clients/avatar_name";
import IconLabelValueItem from "@/components/clients/icon_label_value";
import {
  IconNumber,
  IconMail,
  IconDialpad,
  IconLocation,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import classes from "./Clients.module.css";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";

//TODO: make selectable on tap

const ClientsGrid = ({ data, withFilters, clearFilters }: ClientDataProps) => {
  if (data.length <= 0) {
    return (
      <Center h={"50vh"}>
        <EmptyState
          forDocuments={true}
          withFilters={withFilters}
          onButtonTap={() => {
            clearFilters();
          }}
        />
      </Center>
    );
  }

  return (
    <EqualResponsiveGrid desktopSpan={6} mobileSpan={12}>
      {data.map((record, index) => (
        <div key={index}>
          <ClientGridItem client={record} />
        </div>
      ))}
    </EqualResponsiveGrid>
  );
};

interface GridItemProps {
  client: ClientData;
}

const ClientGridItem = ({ client }: GridItemProps) => {
  const handleClick = () => (window.location.href = `/clients/${client.id}`);

  const t = useTranslations("Clients");

  return (
    <GridItem
      key={client.id}
      onClick={handleClick} // Make the entire Paper clickable
    >
      <Flex gap={"sm"} direction={"row"} align={"start"} justify={"start"}>
        <NameWithAvatar
          name={client.name}
          withName={false}
          color={client.color ?? "metal"}
          size="md"
        />
        <Flex
          direction={"column"}
          align={"start"}
          justify={"start"}
          w={"100%"}
          pr={"md"}
        >
          <Text
            fw={500}
            fz={"md"}
            pr={"sm"}
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "90%", // Set a reasonable max-width for truncation
            }}
          >
            {client.name}
          </Text>
          {client.data && (
            <Text
              c={"dimmed"}
              fw={400}
              fz={"xs"}
            >{`${client.data?.numberOfDocuments} Documents`}</Text>
          )}
        </Flex>
      </Flex>

      <Flex direction={"column"} mt={"lg"}>
        <IconLabelValueItem
          icon={<IconNumber size={12} color="gray" />}
          label={"Reference number"}
          value={client.id!}
        />

        <IconLabelValueItem
          icon={<IconMail size={12} color="gray" />}
          label={"Email address"}
          value={client.email}
        />
        {client.phoneNumber && (
          <IconLabelValueItem
            icon={<IconDialpad size={12} color="gray" />}
            label={"Phone number"}
            value={client.phoneNumber}
          />
        )}
        <IconLabelValueItem
          icon={<IconLocation size={12} color="gray" />}
          label={"Address"}
          value={client.address.address1En}
        />
      </Flex>

      <Divider mt={"xs"} mb={"md"} />

      {client.data && client.document && (
        <ResponsiveGrid desktopSpan={[6, 6]} mobileSpan={[6, 6]}>
          {/* <Flex direction={"column"}> */}
          <Text fw={400} fz={"sm"} className={classes.text}>
            {t("invoiced")}
          </Text>
          <Text fw={500} fz={"sm"} ff={"monospace"} ta={"right"}>
            {client.data &&
              client.document.currency &&
              formatTotal(
                client.data?.outstandingInvoices,
                client.document?.currency
              )}
          </Text>
          {/* </Flex>
          <Flex direction={"column"}> */}
          <Text fw={400} fz={"sm"} className={classes.text}>
            {t("overdue")}
          </Text>
          <Text fw={500} fz={"sm"} ff={"monospace"} ta={"right"}>
            {client.data &&
              client.document.currency &&
              formatTotal(
                client.data.outstandingInvoices,
                client.document?.currency
              )}
          </Text>
          {/* </Flex> */}
        </ResponsiveGrid>
        // <Grid>
        //   <GridCol span={6}>
        //     <Text fw={400} fz={"sm"} className={classes.text}>
        //       {t("invoiced")}
        //     </Text>
        //     <Text fw={500} fz={"sm"} ff={"monospace"}>
        //       {client.data &&
        //         client.document.currency &&
        //         formatTotal(
        //           client.data?.outstandingInvoices,
        //           client.document?.currency
        //         )}
        //     </Text>
        //   </GridCol>
        //   <GridCol span={6}>
        //     <Text fw={400} fz={"sm"} className={classes.text}>
        //       {t("overdue")}
        //     </Text>
        //     <Text fw={500} fz={"sm"} ff={"monospace"}>
        //       {client.data &&
        //         client.document.currency &&
        //         formatTotal(
        //           client.data.outstandingInvoices,
        //           client.document?.currency
        //         )}
        //     </Text>
        //   </GridCol>
        // </Grid>
      )}
    </GridItem>
  );
};

export default ClientsGrid;
