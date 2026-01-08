"use client";

import Logo from "@/components/logo/logo";
import {
  Flex,
  Title,
  rem,
  Center,
  Text,

  Loader,
  AppShell,
  AppShellMain,
  AppShellFooter,
} from "@mantine/core";

import ProfileSelection from "@/components/login_icon/profile_selection";
import LocaleSwitcher from "@/components/language/language_switcher";
import Footer from "@/components/footer/footer";
import { useTranslations } from "next-intl";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import { useContext } from "react";
import { ProfileContext } from "@/contexts/ProfileContext";


//TODO: implement pagination for profiles

const Page = () => {
  const profiles = useContext(ProfileContext);


  if (!(profiles?.isLoading ?? true) && (profiles?.profiles?.length ?? 0) == 0) {
    window.location.href = '/profile/new';
  }

  const t = useTranslations("Home");

  return (
    <AppShell
      withBorder={false}
      footer={{ height: { base: 60, md: 70, lg: 80 } }}
    >
      <AppShellMain>
        <ResponsiveGrid desktopSpan={[3, 6, 3]} mobileSpan={[12]}>
          <Flex hiddenFrom="sm" justify={"flex-end"} m={"xl"}>
            <LocaleSwitcher iconOnly />
          </Flex>

          <Flex
            mt={{ base: "15vh", md: "24vh" }}
            direction={"column"}
            align={"center"}
          >
            <Logo width={80} />

            <Title order={2} fw={500} ta="center" mt={rem(10)}>
              {t("welcome")}
            </Title>
            <Text ta="center" size="md">
              {t("select_business")}
            </Text>

            {(profiles?.isLoading ?? true) && (
              <Center mt={"xl"}>
                <Loader />
              </Center>
            )}
            {!profiles?.isLoading && profiles?.profiles && (
              <Flex mt={"xl"}>
                <ProfileSelection
                  profiles={profiles.profiles}
                  chooseProfile={profiles.chooseProfile}
                />
              </Flex>
            )}
            {profiles?.error && !(profiles?.isLoading ?? true) && <Text mt={"xl"}>Error:{profiles.error}</Text>}
          </Flex>

          <Flex visibleFrom="sm" justify={"flex-end"} m={"xl"}>
            <LocaleSwitcher iconOnly />
          </Flex>
        </ResponsiveGrid>
      </AppShellMain>
      <AppShellFooter>
        <Footer />
      </AppShellFooter>
    </AppShell >
  );
};

export default Page;
