"use client";

import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import Logo from "@/components/logo/logo";
import { ProfileContext } from "@/contexts/ProfileContext";
import { Button, Flex, Text, Title } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useContext } from "react";

//TODO: update design

interface DocumentSuccessProps {
  number: string;
  type: string;
}

const NewDocumentSuccess = ({ number, type }: DocumentSuccessProps) => {
  const t = useTranslations("Documents");
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
          {t("success_document_ttl", {
            type: t(`${type}`),
            number: number,
          })}
        </Title>

        <Text size="sm" c={"dimmed"} ta={"center"} mb={"xl"}>
          {t("success_document_msg", {
            type: t(`${type}`),
          })}
        </Text>

        <Button variant={"light"} leftSection={<IconDownload />}>
          {t("download_pdf")}
        </Button>

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
    </ResponsiveGrid>
  );
};

export default NewDocumentSuccess;
