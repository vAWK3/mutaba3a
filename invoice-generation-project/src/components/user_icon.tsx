"use client";

import { Flex, Menu, rem } from "@mantine/core";
import NameWithAvatar from "./clients/avatar_name";
import { IconChevronDown, IconSettings, IconWorld } from "@tabler/icons-react";
import { ModalType, useModal } from "@/contexts/ModalContext";
import { useTranslations } from "next-intl";

interface UserIconProps {
  userName: string;
  withName?: boolean;
}

const UserIcon: React.FC<UserIconProps> = ({ userName, withName = true }) => {
  const { openModal } = useModal();
  const t = useTranslations("Sidebar");

  const wrapper = (children: React.ReactNode) => {
    return (
      <Menu shadow="md" width="target">
        <Menu.Target>{children}</Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            onClick={() => {
              openModal(ModalType.Settings, {
                defaultTab: "language",
              });
            }}
            leftSection={
              <IconWorld style={{ width: rem(14), height: rem(14) }} />
            }
          >
            {t("language")}
          </Menu.Item>
          <Menu.Divider />

          <Menu.Item
            onClick={() => {
              openModal(ModalType.Settings, {
                defaultTab: "settings",
              });
            }}
            leftSection={
              <IconSettings style={{ width: rem(14), height: rem(14) }} />
            }
          >
            {t("settings")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  };

  return (
    <>
      {wrapper(
        <Flex align="center" justify="space-between" style={{ width: "100%" }}>
          <NameWithAvatar name={userName} color="blue" withName={withName} />
          {withName && <IconChevronDown size={16} />}
        </Flex>
      )}
    </>
  );
};

export default UserIcon;
