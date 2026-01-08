import { Group, Skeleton } from "@mantine/core";

export const RecentDocumentSkeleton = () => {
  return (
    <Group align="center" gap="sm" mb={20}>
      {/* Skeleton for Invoice (Title and Client) */}

      <Skeleton height={30} radius="sm" flex={6} />

      {/* Skeleton for Number */}
      <Skeleton height={30} radius="sm" flex={3} />

      {/* Skeleton for Status */}
      <Skeleton height={30} radius="sm" flex={3} />

      {/* Skeleton for Total */}
      <Skeleton height={30} radius="sm" flex={5} />
    </Group>
  );
  //   return Array(5)
  //     .fill(0)
  //     .map((_, index) => (
  //     ));
};
