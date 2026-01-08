import { Box, Flex, Group, Text } from "@mantine/core";

interface IconLabelValueProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  action?: React.ReactNode;
}

const IconLabelValueItem: React.FC<any> = ({
  icon,
  label,
  value,
  action,
}: IconLabelValueProps) => {
  return (
    <Group align={"center"} justify={"space-between"} mb={12}>
      <Group align={"start"}>
        <Box mt={4} mr={6}>
          {icon}
        </Box>
        <Flex direction={"column"}>
          <Text size="xs" c={"dimmed"} fw={400}>
            {label}
          </Text>
          <Text size="xs">{value}</Text>
        </Flex>
      </Group>
      {action && action}
    </Group>
  );
};

export default IconLabelValueItem;
