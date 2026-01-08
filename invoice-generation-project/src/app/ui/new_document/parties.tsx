"use client";
import NameWithAvatar from "@/components/clients/avatar_name";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import { useUser } from "@auth0/nextjs-auth0/client";
import {
  TextInput,
  Select,
  ComboboxItem,
  SelectProps,
  Group,
  GridProps,
} from "@mantine/core";

import { useTranslations } from "next-intl";
import { ClientData, DocumentData } from "@/types";
import { useEffect, useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { UseFormReturnType } from "@mantine/form";

const iconProps = {
  stroke: 1.5,
  color: "currentColor",
  opacity: 0.6,
  size: 18,
};

const renderSelectOption: SelectProps["renderOption"] = ({
  option,
  checked,
}) => (
  <Group flex="1" gap="xs">
    <NameWithAvatar name={option.label} color={"metal"} />
    {checked && (
      <IconCheck style={{ marginInlineStart: "auto" }} {...iconProps} />
    )}
  </Group>
);

interface PartiesProps extends GridProps {
  form: UseFormReturnType<DocumentData>;
  initialClient?: ClientData;
  clientDisabled: boolean;
  onClientSelect: (client: ClientData) => void;
}

const Parties = ({
  form,
  initialClient,
  clientDisabled,
  onClientSelect,
  ...props
}: PartiesProps) => {
  const { user } = useUser();
  const [clients, setClients] = useState<ClientData[]>();
  const [client, setClient] = useState<ClientData | undefined>(initialClient);

  useEffect(() => {
    //TODO: reinsert
    // if (!user) {
    //   return;
    // }

    const fetchClients = async () => {
      const response = await fetch("/api/clients");
      const data = await response.json();

      if (data.length > 0) {
        setClients(data);
      }
    };

    fetchClients();
  }, [user]);

  const handleClientChange = (value: string | null, option: ComboboxItem) => {
    const selectedClient = clients?.find((client) => client.id === value);
    if (selectedClient) {
      setClient(selectedClient);
      onClientSelect(selectedClient);
    }
  };

  const t = useTranslations("Documents");

  return (
    <ResponsiveGrid desktopSpan={[6, 6]} mobileSpan={[12]} {...props}>
      <TextInput
        label={t("from")}
        disabled
        value={user?.name ?? ""}
        leftSection={
          <NameWithAvatar
            name={user?.name ?? ""}
            withName={false}
            color={"metal"}
          />
        }
      />
      {clients && (
        <Select
          label={t("to")}
          renderOption={renderSelectOption}
          searchable
          disabled={clientDisabled}
          value={client?.id}
          error={form.getInputProps("client").error}
          leftSection={
            <NameWithAvatar
              name={client?.name ?? ""}
              color={client?.color ?? "metal"}
              withName={false}
            />
          }
          onChange={handleClientChange}
          data={clients?.map((item) => {
            return {
              value: item.id!,
              label: item.name,
              color: item.color,
            };
          })}
        />
      )}
    </ResponsiveGrid>
  );
};

export default Parties;
