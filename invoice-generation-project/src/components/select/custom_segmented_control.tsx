"use client";

import {
  Box,
  ScrollArea,
  SegmentedControl,
  SegmentedControlProps,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React from "react";
import classes from "./segmented_control.module.css";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

interface StyledSegmentedControlProps extends SegmentedControlProps {
  data: { value: string; label: React.ReactNode }[];
  queryTerm: string;
  defaultValue: string;
  variant?: 'main' | 'secondary'; // Add variant prop

}

const StyledSegmentedControl: React.FC<StyledSegmentedControlProps> = ({
  queryTerm,
  defaultValue,
  data,
  value,
  variant = 'main', // Default to main variant
  ...props
}) => {
  const isMobile = useMediaQuery("(max-width: 50em)");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  function handleValueChange(value: string) {
    const params = new URLSearchParams(searchParams ?? []);
    if (value) {
      params.set(queryTerm, value);
    } else {
      params.delete(queryTerm);
    }
    replace(`${pathname}?${params.toString()}`);
  }

  return (
    <Box w={"auto"} maw={"100%"}>
      <ScrollArea>
        <SegmentedControl
        classNames={{
          root: classes.root,
          control: variant === 'main' ? classes.controlMain : classes.controlSecondary,
          indicator: variant === 'main' ? classes.indicatorMain : classes.indicatorSecondary,
          label: variant === 'main' ? classes.labelMain : classes.labelSecondary,
        }}
          size={isMobile ? "xs" : "md"}
          withItemsBorders={false}
          autoContrast
          onChange={handleValueChange}
          defaultValue={
            searchParams?.get(queryTerm)?.toString() ?? defaultValue
          }
          value={value}
          data={data}
          {...props}
        />
      </ScrollArea>
    </Box>
  );
};

export default StyledSegmentedControl;
