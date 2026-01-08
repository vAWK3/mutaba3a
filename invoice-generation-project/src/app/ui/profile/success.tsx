"use client";
//TODO: same common layout as pages, maybe move out layout
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import Logo from "@/components/logo/logo";
import { useUser } from "@auth0/nextjs-auth0/client";
import { Flex, Text, Title, Button } from "@mantine/core";
import { useTranslations } from "next-intl";

import Link from "next/link";
import useNavigateToPage from "../../../../utilities/navigation";

interface ProfileSuccessProps {
  email: string;
  profileId: string;
}

const ProfileCreateSuccess = ({ email }: ProfileSuccessProps) => {
  const t = useTranslations("Profile");
  const { navigateToPage } = useNavigateToPage();
  const user = useUser();


  return (
    <ResponsiveGrid desktopSpan={[4, 4, 4]} mobileSpan={[12]}>
      <></>
      <Flex
        align={"center"}
        justify={"center"}
        mt={"15vh"}
        direction={"column"}
      >
        <Logo width={96} />
        <Title mt={"lg"} order={2}>
          {t("success_profile_1")}
        </Title>
        <Title order={2} mb={"md"}>
          {t("success_profile_2")}
        </Title>
        <Flex w={"70%"} ta={"center"}>
          <Text size="sm" c={"dimmed"}>
            {t("send_confirmation_email", { email: email })}
          </Text>
        </Flex>
        {
          //TODO: update dashboard link to profile id
        }
        <Button
          variant="transparent"
          fw={400}

          mt={"xl"}
          onClick={() => navigateToPage('dashboard', {
            verified: false,
          })}
        >
          {t("go_dashboard")}
        </Button>
      </Flex>
      <></>
    </ResponsiveGrid>
  );
};

export default ProfileCreateSuccess;
