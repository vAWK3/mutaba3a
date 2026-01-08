import { Paper, Skeleton } from "@mantine/core";

export function MonthlyOverviewSkeleton({ height }: { height: number }) {
  return (
    <>
      <Paper
        bd={"1px solid metal.1"}
        radius={"md"}
        h={height}
        w={"100%"}
        p={"md"}
      >
        <Skeleton height={12} width="45%" radius="xl" />
        <Skeleton height={8} mt={3} width="30%" radius="xl" />
        <Skeleton height={12} mt={6} width="21%" radius="xl" />
      </Paper>
    </>
  );
}
