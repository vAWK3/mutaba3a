"use client";

import {
  Box,
  Modal,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  ScrollArea,
} from "@mantine/core";
import {
  IconAdjustments,
  IconBriefcase,
  IconUpload,
  IconUser,
  IconWorld,
} from "@tabler/icons-react";

import LanguageSettings from "./language";
import { ReactNode, useEffect, useState } from "react";
import AppSettings from "./app";
import PlanSettings from "./plan";
import AccountSettings from "./account";
import ProfileSettings from "./business";
import { useTranslations } from "next-intl";
import { useMediaQuery } from "@mantine/hooks";
import SettingsContainer from "../../../components/settings/settings_container";

interface SettingsTab {
  value: string;
  title: string;
  icon: ReactNode;
  tab: ReactNode;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: any;
  defaultTab?: string;
}

const SettingsModal = ({
  isOpen,
  onClose,
  defaultTab = "account",
}: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<string | null>(defaultTab);
  const isMobile = useMediaQuery("(max-width: 66em)");

  const t = useTranslations("Settings");

  const tabs: SettingsTab[] = [
    {
      value: "account",
      title: t("account"),
      icon: <IconUser stroke={"1.5"}/>,
      tab: <AccountSettings />,
    },
    {
      value: "business",
      title: t("business"),
      icon: <IconBriefcase stroke={"1.5"}/>,
      tab: <ProfileSettings />,
    },
    {
      value: "settings",
      title: t("settings"),
      icon: <IconAdjustments stroke={"1.5"}/>,
      tab: <AppSettings />,
    },
    {
      value: "language",
      title: t("language"),
      icon: <IconWorld stroke={"1.5"}/>,
      tab: <LanguageSettings />,
    },
    {
      value: "plan",
      title: t("plans"),
      icon: <IconUpload stroke={"1.5"}/>,
      tab: <PlanSettings />,
    },
  ];

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      withCloseButton={false}
      centered
      size={isMobile ? "100%" : "75%"}
      radius={8}
      fullScreen={isMobile}
      overlayProps={{
        backgroundOpacity: 0.55,
      }}
    >
      <Box
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          height: isMobile ? "100%" : "70vh", // Set consistent height on desktop
          margin: "0px",
          padding: "0px",
        }}
      >
        {/* Sidebar TabsList */}
        <Box style={{}}>
          <Tabs
            value={activeTab}
            onChange={setActiveTab}
            color="transparent"
            orientation={isMobile ? "horizontal" : "vertical"}
            style={{
              height: "100%",
            }}
          >
            <TabsList grow={isMobile}>
              {tabs.map((tab, index) => (
                <TabsTab
                  key={index}
                  value={tab.value}
                  leftSection={tab.icon}
                  c={activeTab == tab.value ? "blue" : "metal"}
                >
                  {tab.title}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </Box>

        {/* Content Panel */}
        <Box
          style={{
            flex: 1,
            height: "100%", // Consistent height on desktop
          }}
        >
          <Tabs value={activeTab}>
            {tabs.map((tab, index) => (
              <TabsPanel
                key={index}
                value={tab.value}
                style={{ height: "100%" }}
              >
                <ScrollArea h={isMobile ? "100%" : "calc(70vh - 2rem)"}>
                  <SettingsContainer>{tab.tab}</SettingsContainer>
                </ScrollArea>
              </TabsPanel>
            ))}
          </Tabs>
        </Box>
      </Box>
    </Modal>
  );
};

export default SettingsModal;
