import { Badge, Group, Text } from "@mantine/core";
import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconMinus,
  IconArrowRight,
} from "@tabler/icons-react";
import classes from "./StatusTag.module.css";
interface PercentageCardProps {
  value: number;
}

const PercentageTag: React.FC<PercentageCardProps> = ({ value }) => {
  const percentage = (value * 100).toFixed(0) + "%";
  const isPositive = value > 0;
  const isNegative = value < 0;

  return (
    <Badge
      className={
        isPositive
          ? classes.positive
          : isNegative
          ? classes.negative
          : classes.neutral
      }
      size="lg"
      fw={500}
      px={10}
    >
      <Group gap={3} dir="ltr">
        {isPositive ? (
          <IconArrowUpRight size={18} stroke={2} />
        ) : isNegative ? (
          <IconArrowDownRight size={18} stroke={2} />
        ) : (
          <IconArrowRight size={18} stroke={2} />
        )}
        <Text>{percentage}</Text>
      </Group>
    </Badge>
  );
};

export default PercentageTag;
