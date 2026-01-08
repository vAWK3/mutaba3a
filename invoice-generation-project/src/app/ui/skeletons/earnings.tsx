import { Paper, Skeleton } from "@mantine/core";

export function EarningsSkeleton({ height }: { height: number | string }) {
  return (
    <>
      <Paper
        bd={"1px solid metal.1"}
        radius={"md"}
        h={height}
        w={"100%"}
        p={"md"}
      >
        <Skeleton height={12} width="30%" radius="xl" />
        <Skeleton height={8} mt={3} width="21%" radius="xl" />
        <Skeleton height={12} mt={6} width="80%" radius="xl" />

        <Skeleton height={24} mt={6} width="100%" radius="md" />
        <Skeleton height={24} mt={6} width="100%" radius="md" />
        <Skeleton height={24} mt={6} width="100%" radius="md" />
      </Paper>
    </>
  );
}
