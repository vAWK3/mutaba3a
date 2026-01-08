import { Flex, Text, Image, Space, Grid, GridCol, Group } from "@mantine/core";
import { useTranslations } from "next-intl";

const Footer = () => {
  const tFoot = useTranslations("Footer");

  return (
    <>
      <Grid ta={"center"} align="center" visibleFrom="sm">
        <GridCol span={2}>
          <Image
            src="/logo/elmokhtbr.svg"
            alt="elMokhtbr"
            w={"auto"}
            h={48}
            mx={"xl"}
          />
        </GridCol>
        <GridCol span={8} ta={"center"}>
          <Group align="center" justify="center">
            <Text size="sm" c="dimmed">
              {tFoot("terms")}
            </Text>
            <Text size="sm" c="dimmed">
              {tFoot("privacy")}
            </Text>
            <Text size="sm" c="dimmed">
              {tFoot("copyright")}
            </Text>
          </Group>
        </GridCol>
      </Grid>
      <Flex
        direction={"column"}
        hiddenFrom="sm"
        gap={"md"}
        align="center"
        justify="center"
      >
        <Text size="xs" c="dimmed">
          {tFoot("terms")}
        </Text>
        <Text size="xs" c="dimmed">
          {tFoot("privacy")}
        </Text>
        <Text size="xs" c="dimmed">
          {tFoot("copyright")}
        </Text>
        <Image src="/logo/elmokhtbr.svg" alt="elMokhtbr" w={"auto"} h={48} />
      </Flex>
    </>
  );
};

export default Footer;
