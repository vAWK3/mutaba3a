import NameWithAvatar from "@/components/clients/avatar_name";
import IconLabelValueItem from "@/components/clients/icon_label_value";
import {
  Flex,
  Space,
  Divider,
  ActionIcon,
  Button,
  Grid,
  Center,
  Box,
  UnstyledButton,
  GridCol,
} from "@mantine/core";
import {
  IconCopy,
  IconDialpad,
  IconIdBadge,
  IconLocation,
  IconMail,
  IconNumber,
  IconPencil,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { ClientData } from "@/types";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";

interface ClientDetailsProps {
  client: ClientData;
}

export default function ClientDetails({ client }: ClientDetailsProps) {
  const t = useTranslations("Clients");

  const { copy, copied } = useClipboard();

  return (
    <Flex
      direction={"column"}
      justify={"space-between"}
      mt={30}
      mb={12}
      mx={12}
      h={"100%"}
    >
      <Flex direction={"column"}>
        <NameWithAvatar
          color={client.color ?? "metal"}
          name={client.name}
          size="lg"
        />
        <Space h={"xl"} />
        <IconLabelValueItem
          icon={<IconNumber size={12} color="gray" />}
          label={t("number")}
          value={client.id!}
        />

        <Box
          onClick={() => {
            copy(client.email); // Attempt to copy the email
            notifications.show({
              title: t("copy_success"),
              message: "",
            });
          }}
        >
          <IconLabelValueItem
            icon={<IconMail size={12} color="gray" />}
            label={t("email")}
            value={client.email}
            action={
              <ActionIcon variant="default" size={"xs"}>
                <IconCopy />
              </ActionIcon>
            }
          />
        </Box>
        {client.phoneNumber && (
          <IconLabelValueItem
            icon={<IconDialpad size={12} color="gray" />}
            label={t("phone")}
            value={client.phoneNumber}
          />
        )}
        <IconLabelValueItem
          icon={<IconLocation size={12} color="gray" />}
          label={t("address")}
          value={client.address.address1En}
        />
        <IconLabelValueItem
          icon={<IconIdBadge size={12} color="gray" />}
          label={t("tax_id")}
          value={client.id}
        />
        <Divider size={"xs"} color={"metal.9"} />
      </Flex>
      <Grid>
        <GridCol span={6}>
          <Button
            variant="default"
            fw={500}
            p={"xs"}
            leftSection={<IconPencil size={12} />}
          >
            {t("edit")}
          </Button>
        </GridCol>
        <GridCol span={6}>
          <Button variant="transparent" color="red">
            {t("delete")}
          </Button>
        </GridCol>
      </Grid>
    </Flex>
  );
}
