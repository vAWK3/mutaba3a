"use client";
import CreateDocumentButton from "@/components/buttons/create_document_button";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import Logo from "@/components/logo/logo";
import { ProfileContext } from "@/contexts/ProfileContext";
import { Button, Flex, Text, Title } from "@mantine/core";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useContext } from "react";

interface ClientSuccessProps {
  name: string;
}

const ClientCreateSuccess = ({ name }: ClientSuccessProps) => {
  const t = useTranslations("Clients");
  const profiles = useContext(ProfileContext);

  return (
    <ResponsiveGrid desktopSpan={[4, 4, 4]} mobileSpan={[12]}>
      <></>
      <Flex
        align={"center"}
        justify={"center"}
        mt={"15vh"}
        w={"100%"}
        ta={"center"}
        direction={"column"}
      >
        <Logo width={96} />

        <Title order={2} mt={"lg"} mb={"md"} ta={"center"}>
          {t("success_client_ttl")}
        </Title>

        <Text size="sm" c={"dimmed"} ta={"center"} mb={"xl"}>
          {t("success_client_msg")}
        </Text>

        <CreateDocumentButton
          variant={"light"}
          client={name}
          iconOnly={false}
        />

        <Button
          variant="transparent"
          component={Link}
          href={`${profiles?.activeProfile?.id}/documents`}
          mt={"lg"}
        >
          {t("back_documents")}
        </Button>
      </Flex>
      <></>
    </ResponsiveGrid >
  );
};

export default ClientCreateSuccess;
