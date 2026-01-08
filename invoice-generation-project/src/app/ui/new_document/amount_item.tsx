import { ResponsiveGrid } from "@/components/grid/responsive_grid";

import { Text } from "@mantine/core";

const AmountItem = ({
  label,
  forex,
  amount,
}: {
  label: string;
  forex?: string;
  amount: string;
}) => {
  return (
    <ResponsiveGrid desktopSpan={[8, 2, 2]} mobileSpan={[6, 4, 4]}>
      <Text>{label}</Text>
      {forex && (
        <Text ff={"monospace"} c="dimmed">
          {forex}
        </Text>
      )}
      {!forex && <></>}
      <Text ff={"monospace"} ta={"left"} dir="ltr">
        {amount}
      </Text>
    </ResponsiveGrid>
  );
};

export default AmountItem;
