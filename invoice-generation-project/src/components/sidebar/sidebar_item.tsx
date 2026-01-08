import { usePathname } from "next/navigation";
import { Box, Button, Group, rem } from "@mantine/core";
import Link from "next/link";

import classes from "./Sidebar.module.css";
import { IconArrowRight } from "@tabler/icons-react";

const SidebarItem: React.FC<any> = ({ icon, path, action, title }) => {
  const pathname = usePathname();
  const isActive = pathname == path;

  const content = (
    <Button
      variant="transparent"
      className={`${classes.item} ${
        isActive ? classes.active : classes.inactive
      } ${isActive?" " :classes.label}`}
      w={title ? "90%" : "100%"}
      size="sm"
      fw={500}
      onClick={!path && action ? action : undefined}
      justify={title ? "start" : "center"}
    >
      <Group>
        {icon && (
          <span className={isActive ? classes.active : classes.inactive}>
            {icon}
          </span>
        )}
        {title && <span>{title}</span>}
      </Group>
    </Button>
  );

  return path ? (
    <Link href={path} legacyBehavior>
      {content}
    </Link>
  ) : (
    content
  );
};

export default SidebarItem;
