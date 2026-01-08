"use client";

import { Group, Text, Flex, Progress, Anchor, GroupProps } from "@mantine/core";
import { formatTotal } from "../../../../utilities/formatters";
import NameWithAvatar from "../../../components/clients/avatar_name";
import { useRouter } from "next/navigation";
import { ClientData } from "@/types";

interface ClientRowProps extends GroupProps {
  client: ClientData;
  progress?: number;
  documentLabel: string;
  withTotal?: boolean;
}

const ClientRow: React.FC<ClientRowProps> = ({
  client,
  progress,
  documentLabel,
  withTotal = true,
  ...props
}) => {
  const router = useRouter();

  return (
    <Group
      style={{ cursor: "pointer" }}
      justify="space-between"
      w={"100%"}
      align="center"
      onClick={() => {
        router.push(`/clients/${client.id}`);
      }}
      {...props}
    >
      <Group>
        <NameWithAvatar
          name={client.name}
          withName={false}
          color={client.color}
        />
        <Flex direction={"column"}>
          <Text size="sm" fw={500}>
            {client.name}
          </Text>
          <Text size="sm" c={"dimmed"}>
            {`${client.data?.numberOfDocuments} ${documentLabel}`}
          </Text>
        </Flex>
      </Group>
      {withTotal && (
        <Flex direction={"column"}>
          <Text ff={"monospace"}>
            {client.data &&
              client.document?.currency &&
              formatTotal(
                client.data?.outstandingInvoices,
                client.document?.currency
              )}
          </Text>
          {progress && <Progress value={progress} size={"xs"} />}
        </Flex>
      )}
    </Group>
  );
};

export default ClientRow;
