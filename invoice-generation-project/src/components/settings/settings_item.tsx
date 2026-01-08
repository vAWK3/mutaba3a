// components/Sidebar.tsx
import { Text, Flex, Grid } from "@mantine/core";
import classes from "./Settings.module.css";

const SettingsItem: React.FC<any> = ({
  title,
  description,
  action,
  marginTop,
}) => {
  return (
    <Grid mt={marginTop}>
      <Grid.Col span={9}>
        <Flex direction={"column"} w={"100%"} gap={0}>
          <Text fw={400} fz={"md"} className={classes.title} m={0}>
            {title}
          </Text>
          <Text fw={400} fz={"sm"} className={classes.description} m={0}>
            {description}
          </Text>
        </Flex>
      </Grid.Col>
      <Grid.Col span={3}>{action}</Grid.Col>
    </Grid>
  );
};

export default SettingsItem;
