import { Grid, GridCol, GridProps } from "@mantine/core";
import React from "react";

interface ResponsiveGridProps extends GridProps {
  children: React.ReactNode[] | React.ReactNode;
  desktopSpan: number[]; // Span for desktop view
  mobileSpan: number[]; // Span for mobile view
  width?: number | string;
}

export const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  children,
  desktopSpan,
  mobileSpan,
  width = "100%",
  ...props
}) => {
  const childrenArray = React.Children.toArray(children);
  const isSoleChild = childrenArray.length === 1;

  return (
    <Grid grow w={width} {...props}>
      {isSoleChild && (
        <GridCol key={"first"} span={desktopSpan[0]} visibleFrom="sm">
          {/* Empty GridCol to center the child */}
        </GridCol>
      )}

      {childrenArray.map((child, index) => (
        <React.Fragment key={index}>
          {/* Mobile GridCol */}
          <GridCol span={mobileSpan[index] ?? mobileSpan[0]} hiddenFrom="sm">
            {child}
          </GridCol>

          {/* Desktop GridCol */}
          <GridCol span={desktopSpan[index] ?? desktopSpan[0]} visibleFrom="sm">
            {child}
          </GridCol>
        </React.Fragment>
      ))}

      {(isSoleChild || childrenArray.length < desktopSpan.length) && (
        <GridCol
          key={"lat"}
          span={desktopSpan[2] ?? desktopSpan[0]}
          visibleFrom="sm"
        >
          {/* Empty GridCol to center the child */}
        </GridCol>
      )}
    </Grid>
  );
};
