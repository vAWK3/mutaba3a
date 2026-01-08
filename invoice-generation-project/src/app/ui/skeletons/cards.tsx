import { Paper, Skeleton } from "@mantine/core";
import { EqualResponsiveGrid } from "@/components/grid/equal_responsive_grid";

export function InvoiceCardSkeleton() {
  return (
    <>
      <Paper bd={"1px solid metal.1"} radius={"md"} w={"100%"} p={"md"}>
        <Skeleton height={12} width="30%" radius="xl" />
        <Skeleton height={16} mt={12} width="60%" radius="xl" />
        <Skeleton height={12} mt={6} width="21%" radius="xl" />
      </Paper>
    </>
  );
}

export function InvoiceCardsSkeleton() {
  return (
    <EqualResponsiveGrid desktopSpan={3} mobileSpan={6}>
      <InvoiceCardSkeleton />
      <InvoiceCardSkeleton />
      <InvoiceCardSkeleton />
      <InvoiceCardSkeleton />
    </EqualResponsiveGrid>
  );
}
