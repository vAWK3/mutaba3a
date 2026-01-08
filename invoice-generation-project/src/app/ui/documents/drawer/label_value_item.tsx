import { Flex, Text } from "@mantine/core";

interface LabelValueItemProps {
  label: string;
  value?: string;
  element?: React.ReactNode;
}

const LabelValueItem: React.FC<any> = ({
  label,
  value,
  element,
}: LabelValueItemProps) => {
  return (
    <Flex direction={"column"}>
      <Text size="sm" fw={600} mb={"3"}>
        {label}
      </Text>
      {value && <Text size="md">{value}</Text>}
      {element && element}
    </Flex>
  );
};

export default LabelValueItem;
