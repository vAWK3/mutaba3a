import React from "react";
import { Grid, Text } from "@mantine/core";
import classes from "../../../components/settings/Settings.module.css";

interface ComparisonItem {
  title: string; // Can be text or a React element
  free: React.ReactNode; // Can be text or a React element
  unlimited: React.ReactNode;
}

interface ComparisonChartProps {
  items: ComparisonItem[];
}

const ComparisonChart: React.FC<ComparisonChartProps> = ({ items }) => {
  return (
    <Grid w={"100%"}>
      {items.map((item, index) => {
        const isEvenRow = index % 2 === 0;

        return (
          <React.Fragment key={index}>
            <Grid
              w={"100%"}
              className={isEvenRow ? classes.even : classes.odd}
              p={"md"}
            >
              <Grid.Col span={4}>
                <Text size="md">{item.title}</Text>
              </Grid.Col>
              <Grid.Col span={4}>
                {typeof item.free === "string" ? (
                  <Text size="md">{item.free}</Text>
                ) : (
                  item.free
                )}
              </Grid.Col>
              <Grid.Col span={4}>
                {typeof item.free === "string" ? (
                  <Text size="md">{item.unlimited}</Text>
                ) : (
                  item.unlimited
                )}
              </Grid.Col>
            </Grid>
          </React.Fragment>
        );
      })}
    </Grid>
  );
};

export default ComparisonChart;
