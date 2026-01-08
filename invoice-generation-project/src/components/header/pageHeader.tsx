import { Box, Group, rem, Title, Text, Flex } from "@mantine/core";
interface HeaderProps {
  title: string | undefined;
  subtitle: string | undefined;
  titleSize?: number;
  buttons?: React.ReactNode;
}

const PageHeader = ({
  title,
  subtitle,
  buttons,
  titleSize = 30,
}: HeaderProps) => {
  return (
    <Box mb={{ base: 16, md: 21, lg: 30 }}>
      <Group grow justify="space-between">
        {title && (
          <Flex direction="column" align="start">
            {" "}
            {/* Stack title and subtitle vertically */}
            {/* Title displayed above */}
            <Title visibleFrom="sm" order={1} fz={rem(36)} fw={500}>
              {title}
            </Title>
            <Title hiddenFrom="sm" order={2} fz={rem(28)} fw={500}>
              {title}
            </Title>
            {/* Subtitle displayed below the title */}
            {subtitle && (
              <Text size="md" c={"dimmed"}>
                {subtitle}
              </Text>
            )}
          </Flex>
        )}
        {buttons && (
          <Group justify="flex-end" align="start">
            {buttons}
          </Group>
        )}
      </Group>
    </Box>
  );
};

export default PageHeader;
