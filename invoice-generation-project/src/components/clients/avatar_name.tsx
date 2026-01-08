import { Group, Avatar } from "@mantine/core";
import { getInitials } from "../../../utilities/formatters";

interface NameProps {
  name: string;
  color?: string;
  withName?: boolean;
  size?: string;
}

export default function NameWithAvatar({
  name,
  color,
  withName = true,
  size = "sm",
}: NameProps) {
  const avatar = (
    <Avatar color={color ?? "metal"} radius="md" size={size}>
      {getInitials(name)}
    </Avatar>
  );

  return (
    <Group>
      {avatar}
      {withName && name}
    </Group>
  );
}
