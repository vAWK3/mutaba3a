import { Box, Text } from "@mantine/core";
import { formatTotal } from "../../../../../utilities/formatters";
import { ResponsiveGrid } from "../../../../components/grid/responsive_grid";
import { useTranslations } from "next-intl";
import { Currency, DocumentItem } from "@/types";

interface DocumentItemsProps {
  items: DocumentItem[];
  currency: Currency;
}

const DocumentItems: React.FC<any> = ({
  items,
  currency,
}: DocumentItemsProps) => {
  const t = useTranslations("Documents");

  return (
    <Box w={"100%"}>
      <ResponsiveGrid desktopSpan={[6, 2, 2, 2]} mobileSpan={[3, 3, 3, 3]}>
        <Text size={"md"} fw={500}>
          {t("item")}
        </Text>
        <Text size={"md"} fw={500} dir="ltr" ta={"right"}>
          {t("quantity")}
        </Text>
        <Text size={"md"} fw={500} dir="ltr" ta={"right"}>
          {t("rate")}
        </Text>
        <Text size={"md"} fw={500} dir="ltr" ta={"right"}>
          {t("price")}
        </Text>
      </ResponsiveGrid>
      {items.map((item, index) => {
        return (
          <div key={index}>
            <ResponsiveGrid
              desktopSpan={[6, 2, 2, 2]}
              mobileSpan={[3, 3, 3, 3]}
            >
              <Text size={"sm"}>{item.name}</Text>
              <Text ff={"monospace"} size={"sm"} dir="ltr" ta={"right"}>
                {item.quantity}
              </Text>
              <Text ff={"monospace"} size={"sm"} dir="ltr" ta={"right"}>
                {formatTotal(item.rate, currency)}
              </Text>
              <Text ff={"monospace"} size={"sm"} dir="ltr" ta={"right"}>
                {formatTotal(item.rate * item.quantity, currency)}
              </Text>
            </ResponsiveGrid>
          </div>
        );
      })}
    </Box>
  );
};

export default DocumentItems;
