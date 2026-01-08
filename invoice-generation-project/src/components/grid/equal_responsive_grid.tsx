import { Grid, GridCol, GridProps } from "@mantine/core";
import React from "react";

interface ResponsiveGridProps extends GridProps {
  children: React.ReactNode[];
  desktopSpan: number; // Span for desktop view
  mobileSpan: number; // Span for mobile view
}

export const EqualResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  children,
  desktopSpan,
  mobileSpan,
  ...props
}) => {
  return (
    <Grid w={"100%"} {...props}>
      {children.map((child, index) => (
        <React.Fragment key={index}>
          <GridCol span={mobileSpan} hiddenFrom="sm">
            {child}
          </GridCol>

          <GridCol span={desktopSpan} visibleFrom="sm">
            {child}
          </GridCol>
        </React.Fragment>
      ))}
    </Grid>
  );
};
