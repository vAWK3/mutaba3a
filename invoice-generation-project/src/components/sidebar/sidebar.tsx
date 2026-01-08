"use client";

import SidebarGroup from "./sidebar_group";
import SidebarItem from "./sidebar_item";
import {
  AppShellNavbar,
  AppShellSection,
  Box,
  Flex,
  useMantineColorScheme,
} from "@mantine/core";
import UserIcon from "../user_icon";
import Logo from "../logo/logo";

import {
  IconBell,
  IconFileDescription,
  IconHelp,
  IconSearch,
  IconUpload,
  IconUserSquareRounded,
  IconPresentation,
  IconChevronRight,
} from "@tabler/icons-react";
import Link from "next/link";


import { searchSpotlight } from "../spotlight/search_spotlight";
import { useUser } from "@auth0/nextjs-auth0/client";
import { ModalType, useModal } from "@/contexts/ModalContext";
import { useTranslations } from "next-intl";
import { usePlan } from "@/hooks/usePlan";
import useNavigateToPage from "../../../utilities/navigation";
import path from "path";

interface SidebarProps {
  burgerButton?: any;
  fullWidth?: boolean;
}

const Sidebar = ({ burgerButton, fullWidth = true }: SidebarProps) => {
  const user = useUser();
  const t = useTranslations("Sidebar");
  const { openModal } = useModal();
  const { plan } = usePlan(user.user?.sub ?? "1");
  const { navigateToPage } = useNavigateToPage();

  {
    //TODO: update all links to include profile id
  }

  const sidebarItems = [
    {
      title: fullWidth ? t("dashboard") : null,
      path: "/3/dashboard",
      // action: () => navigateToPage('dashboard'),
      icon: <IconPresentation strokeWidth={1.5} />,
    },
    {
      title: fullWidth ? t("documents") : null,
      path: "/3/documents",
      // action: () => navigateToPage('documents'),
      icon: <IconFileDescription strokeWidth={1.5} />,
    },
    {
      title: fullWidth ? t("clients") : null,
      // action: () => navigateToPage('clients'),
      path: "/3/clients",
      icon: <IconUserSquareRounded strokeWidth={1.5} />,
    },
    {
      title: fullWidth ? t("search") : null,
      action: searchSpotlight.open,
      icon: <IconSearch strokeWidth={1.5} />,
    },
  ];

  return (
    <AppShellNavbar>
      <AppShellSection>
        <Flex
          justify={fullWidth ? "space-between" : "center"}
          mt={"md"}
          mb={"md"}
          px={"md"}
        >
          <Link href="/">
            <Logo
              width={30}
              wordmark={fullWidth}
            />
          </Link>
          {burgerButton}
        </Flex>
      </AppShellSection>
      <AppShellSection grow>
        <SidebarGroup
          icon={fullWidth ? <IconChevronRight /> : null}
          items={sidebarItems}
        />
      </AppShellSection>
      <AppShellSection>
        <SidebarItem
          title={fullWidth ? t("help") : null}
          icon={<IconHelp strokeWidth={1.5} />}
          path="/help"
        />
        <SidebarItem
          title={fullWidth ? t("updates") : null}
          icon={<IconBell strokeWidth={1.5} />}
          path="/updates"
        />
        <SidebarItem
          title={
            fullWidth && plan ? t(`${plan.plan.nameEn.toLowerCase()}`) : null
          }
          icon={<IconUpload strokeWidth={1.5} />}
          action={() => {
            openModal(ModalType.Settings, {
              defaultTab: "plan",
            });
          }}
        />

        <Box mt="xs" p="md">
          <UserIcon
            userName={user.user?.nickname ?? "User"}
            withName={fullWidth}
          />
        </Box>
      </AppShellSection>
    </AppShellNavbar>
  );
};

export default Sidebar;
