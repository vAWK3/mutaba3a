import React, { MouseEventHandler } from "react";
import { Paper } from "@mantine/core";
import styles from "./grid_item.module.css";

interface GridItemProps {
  children: React.ReactNode;
  onClick: MouseEventHandler<HTMLDivElement>;
}

const GridItem = ({ children, onClick }: GridItemProps) => {
  return (
    <Paper
      p={"md"}
      bd={"1px solid metal.1"}
      bg={"transparent"}
      radius={8}
      className={styles.item}
      onClick={onClick}
    >
      {children}
    </Paper>
  );
};

export default GridItem;
