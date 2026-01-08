// components/Sidebar.tsx
"use_client";

import SidebarItem from "@/components/sidebar/sidebar_item";
import { Text, Collapse, Box } from "@mantine/core";

interface SidebarGroupProps {
  // icon: React.ReactNode;
  items: {
    title: string;
    path: string;
    icon: React.ReactNode;
    action?: () => void;
  }[];
  title: string;
  collapsible?: boolean;
}

const SidebarGroup: React.FC<any> = ({
  // icon,
  items,
  title,
  collapsible = false,
}: SidebarGroupProps) => {
  // const [opened, { toggle }] = useDisclosure(false);

  const itemList = (
    <Box>
      {items.map((item: any, index: number) => (
        <SidebarItem
          key={index}
          title={item.title}
          path={item.path}
          icon={item.icon}
          action={item.action}
        />
      ))}
    </Box>
  );

  if (!title) {
    return itemList;
  }

  return (
    <Box>
      {title && (
        // <UnstyledButton
        //   // onClick={collapsible ? toggle : undefined}
        //   style={{
        //     display: "flex",
        //     alignItems: "center",
        //     justifyContent: "space-between",
        //   }}
        // >
        <Text fz={"sm"} p="md" c={"metal.7"}>
          {title}
        </Text>
        /*{ {opened ? <ArrowDownIcon></ArrowDownIcon> : icon} 
         </UnstyledButton> */
      )}
      {collapsible ? (
        <Collapse
          // in={opened}
          in={true}
          transitionDuration={420}
          transitionTimingFunction="linear"
        >
          {items.map((item: any, index: number) => (
            <SidebarItem
              key={index}
              title={item.title}
              path={item.path}
              icon={item.icon}
              action={item.action}
            />
          ))}
        </Collapse>
      ) : (
        itemList
      )}
    </Box>
  );
};

export default SidebarGroup;
