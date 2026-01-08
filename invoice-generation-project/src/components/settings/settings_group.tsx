"use_client";

import { Box, Divider, Title, rem } from "@mantine/core";
import SettingsItem from "./settings_item";

interface SettingsGroupProps {
  items: {
    title: string;
    description: string;
    action: any;
  }[];
  title: string;
}

const SettingsGroup: React.FC<any> = ({ items, title }: SettingsGroupProps) => {
  const itemList = (
    <Box>
      {items &&
        items.map((item: any, index: number) => (
          <SettingsItem
            marginTop="md"
            key={index}
            title={item.title}
            description={item.description}
            action={item.action}
          />
        ))}
    </Box>
  );

  if (!title) {
    return itemList;
  }

  return (
    <Box w={"100%"}>
      <Title order={4} size={"md"} fw={500} mb={rem(12)}>
        {title}
      </Title>
      <Divider />
      {itemList}
    </Box>
  );
};

export default SettingsGroup;
