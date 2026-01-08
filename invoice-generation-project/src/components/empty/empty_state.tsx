import { Flex, Title, Button, Anchor, Text } from "@mantine/core";
import { IconFileArrowRight, IconFilterCancel } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

interface EmptyProps {
  forDocuments: boolean;
  withFilters: boolean;
  onButtonTap: any;
}

const EmptyState = ({ forDocuments, withFilters, onButtonTap }: EmptyProps) => {
  const td = useTranslations("Documents");
  const tc = useTranslations("Clients");
  const tb = useTranslations("Buttons");

  return (
    <Flex direction="column" align={"center"}>
      <Title order={3} c="metal.9">
        {forDocuments ? td("empty_results") : tc("empty_results")}
      </Title>

      <Text fz={18} fw={400} c={"metal.6"} ta={"center"}>
        {withFilters
          ? forDocuments
            ? td("clear_filters")
            : tc("clear_filters")
          : forDocuments
          ? td("create_first")
          : tc("create_first")}
      </Text>
      <Button
        fw={400}
        m={"md"}
        variant="light"
        onClick={() => {
          onButtonTap();
        }}
        leftSection={
          withFilters ? (
            <IconFilterCancel stroke={1} />
          ) : (
            <IconFileArrowRight stroke={1} />
          )
        }
      >
        {withFilters ? tb("clear_filters") : tb("import_csv")}
      </Button>
      {!withFilters && (
        <p>
          {td("or")}{" "}
          <Anchor underline="always">
            {tb("create_first", {
              type: forDocuments ? td("document") : tc("client"),
            })}
          </Anchor>
        </p>
      )}
    </Flex>
  );
};

export default EmptyState;
