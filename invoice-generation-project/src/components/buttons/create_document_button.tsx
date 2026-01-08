"use client";
import {
  ActionIcon,
  Button,
  Group,
  Menu,
  MenuDropdown,
  MenuItem,
  MenuTarget,
  Text,
} from "@mantine/core";
import { IconPencilPlus } from "@tabler/icons-react";
import { NewDocumentType } from "@/types";
import { useTranslations } from "next-intl";
import NameWithAvatar from "../clients/avatar_name";
import { useClientSpotlight } from "@/contexts/SpotlightContext";

interface ButtonProps {
  variant: string;
  withIcon?: boolean;
  client?: string;
  iconOnly?: boolean;
}

const CreateDocumentButton = ({
  variant,
  withIcon = true,
  client,
  iconOnly = false,
}: ButtonProps) => {
  const t = useTranslations("Buttons");
  const td = useTranslations("Documents");
  const { openSpotlight, closeSpotlight } = useClientSpotlight();

  return (
    <Menu width={"target"}>
      {iconOnly && (
        <MenuTarget>
          {iconOnly && (
            <ActionIcon variant={variant} color={"blue.6"}>
              <IconPencilPlus strokeWidth={1.5} />
            </ActionIcon>
          )}
        </MenuTarget>
      )}
      {!iconOnly && (
        <MenuTarget>
          <Button
            variant={variant}
            color={"blue.6"}
            leftSection={withIcon && <IconPencilPlus strokeWidth={1.5} />}
          >
            {!client && t("create_document")}
            {client && (
              <Group>
                <Text>{client && t("create_document_for")}</Text>
                <NameWithAvatar withName={false} name={client} color="metal" />
              </Group>
            )}
          </Button>
        </MenuTarget>
      )}
      <MenuDropdown>
        {Object.values(NewDocumentType).map((item, index) => {
          return (
            <MenuItem onClick={() => openSpotlight(item)} key={index}>
              {td(`${item}`)}
            </MenuItem>
          );
        })}
      </MenuDropdown>
    </Menu>
  );
};

export default CreateDocumentButton;
