"use client";

import {
  AppShell,
  Box,
  AppShellHeader,
  AppShellAside,
  AppShellMain,
  AppShellResponsiveSize,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import Sidebar from "../sidebar/sidebar";
import { ReactNode, useState } from "react";
import AppHeader from "../header/appHeader";

import styles from "../../../styles/Common.module.css";
import classes from "./CustomAppShell.module.css";

import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";

interface AppShellProps {
  children: React.ReactNode;
  isFullWidth?: boolean;
  disabled?: boolean;
  onExport?: any;
  onToggleSidebar?: any;
  withNavbar?: boolean;
  headerButtons?: ReactNode | ReactNode[];
  screenHeight?: string;
  withMain?: boolean;
  removeLastPath?: boolean;
  aside?: React.ReactNode;
  asideWidth?: AppShellResponsiveSize;
  withBreadcrumb?: boolean;
  exitButton?: React.ReactNode; // Add leftButton prop
}

export function ResponsiveSizeAppShell({
  children,
  disabled = false,
  isFullWidth = false,
  onExport,
  onToggleSidebar,
  withNavbar = true,
  headerButtons,
  withMain = true,
  screenHeight,
  removeLastPath,
  aside,
  asideWidth,
  exitButton,
  withBreadcrumb = true,
}: AppShellProps) {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure();

  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (onToggleSidebar) {
      onToggleSidebar("full");
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (onToggleSidebar) {
      onToggleSidebar(desktopOpened ? "full" : "icon");
    }
  };

  return (
    <AppShell
      layout="alt"
      footer={{ height: { base: 60, md: 70, lg: 80 }, offset: true }}
      header={{ height: { base: 60, md: 60, lg: 60 }, offset: true }}
      aside={{
        width: asideWidth ?? {
          base: aside == undefined ? 0 : 260,
          md: aside == undefined ? 0 : 260,
          lg: aside == undefined ? 0 : 260,
        },
        breakpoint: "sm",
        collapsed: { desktop: false, mobile: true },
      }}
      navbar={{
        width: !withNavbar
          ? 0
          : {
              base: isHovered || desktopOpened ? 125 : 47,
              md: isHovered || desktopOpened ? 225 : 62,
              // lg: isHovered || desktopOpened ? 250 : 62,
            },
        breakpoint: "sm",
        collapsed: { mobile: !mobileOpened },
      }}
      padding={{ base: 10, sm: 15, lg: "md" }}
      pr={
        asideWidth == undefined
          ? undefined
          : {
              base: (asideWidth["base"] as number) * 0.1,
              md: (asideWidth["md"] as number) * 0.1,
              lg: (asideWidth["lg"] as number) * 0.1,
            }
      }
      mr={
        asideWidth == undefined
          ? undefined
          : {
              base: asideWidth["base"],
              md: asideWidth["md"],
              lg: asideWidth["lg"],
            }
      }
      disabled={disabled}
    >
      <AppShellHeader pr={aside !== undefined ? 30 : 0} withBorder>
        <AppHeader
          burgerButton={
            withNavbar && (
              <Box
                className={styles.iconWrapper}
                onClick={toggleMobile}
                hiddenFrom="sm"
                hidden={mobileOpened}
                size="sm"
              >
                {mobileOpened ? (
                  <IconLayoutSidebarLeftCollapse size={20} />
                ) : (
                  <IconLayoutSidebarLeftExpand size={20} />
                )}
              </Box>
            )
          }
          onExport={onExport}
          buttons={headerButtons}
          removeLastPath={removeLastPath}
          withBreadcrumb={withBreadcrumb}
          exitButton={exitButton}
        ></AppHeader>
      </AppShellHeader>
      {withNavbar && (
        <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <Sidebar
            fullWidth={isHovered || desktopOpened || mobileOpened}
            burgerButton={
              <>
                <Box
                  className={styles.iconWrapper}
                  onClick={toggleMobile}
                  hiddenFrom="sm"
                  size="xs"
                  px={0}
                  m={0}
                >
                  {mobileOpened ? (
                    <IconLayoutSidebarLeftCollapse size={20} />
                  ) : (
                    <IconLayoutSidebarLeftExpand size={20} />
                  )}
                </Box>

                {(isHovered || desktopOpened) && (
                  <Box
                    className={`${styles.iconWrapper} ${
                      desktopOpened ? styles.active : ""
                    }`}
                    visibleFrom="sm"
                    size="xs"
                    px={2}
                    onClick={() => {
                      toggleDesktop();
                      if (onToggleSidebar) {
                        onToggleSidebar(desktopOpened ? "icon" : "full");
                      }
                    }}
                  >
                    {desktopOpened ? (
                      <IconLayoutSidebarLeftCollapse size={20} />
                    ) : (
                      <IconLayoutSidebarLeftExpand size={20} />
                    )}
                  </Box>
                )}
              </>
            }
          ></Sidebar>
        </div>
      )}
      {withMain ? (
        <AppShellMain
          mt={"lg"}
          mb={"xl"}
          mr={aside !== undefined ? 30 : 0}
          pb={0}
          h={screenHeight ?? "80vh"}
          className={classes.main}
        >
          <Box w={"100%"} maw={isFullWidth ? undefined : "1366px"}>
            {children}
          </Box>{" "}
        </AppShellMain>
      ) : (
        <Box
          w={"100%"}
          maw={isFullWidth ? undefined : "1366px"}
          mt={120}
          ml={"xl"}
          mr={"xl"}
        >
          {children}
        </Box>
      )}
      {aside && (
        <AppShellAside h={screenHeight ?? "100vh"}>{aside}</AppShellAside>
      )}
    </AppShell>
  );
}
