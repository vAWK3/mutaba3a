import { Paper, Text, Group, Flex, PaperProps } from "@mantine/core";
import { Currency, DocumentData } from "@/types";
import { formatTotal } from "../../../../utilities/formatters";
import classes from "@styles/Common.module.css";
import { useTranslations } from "next-intl";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import AmountItem from "./amount_item";
import { UseFormReturnType } from "@mantine/form";
interface DocumentTotalContainerProps extends PaperProps {
  // form: UseFormReturnType<DocumentData>;
  document: DocumentData;
  exchangeRate: number;
  taxPercent: number;
}

const DocumentAmounts: React.FC<any> = ({
  // form,
  document,
  exchangeRate,
  taxPercent,
  ...props
}: DocumentTotalContainerProps) => {
  const t = useTranslations("Documents");

  const currency = document.settings.currency;
  const subtotal = document.subtotal;
  const discount = document.discount;

  const tax = (subtotal - discount) * taxPercent;
  const total = subtotal - discount + tax;
  // const tax = form.getValues().tax;
  // const total = form.getValues().total;

  const percent = (discount / subtotal) * 100;

  console.log("subtotal is ", subtotal);

  return (
    <Paper
      w={"100%"}
      className={classes.container}
      radius={4}
      m={0}
      p={"md"}
      {...props}
    >
      <AmountItem
        label={t("subtotal")}
        forex={
          currency == Currency.Dollar && subtotal > 0
            ? `~${formatTotal(subtotal * exchangeRate, Currency.Shekel)}`
            : undefined
        }
        amount={formatTotal(subtotal, currency)}
      />

      {discount > 0 && (
        <AmountItem
          label={`${t("discount")} ${percent.toFixed(2)}%`}
          forex={
            currency == Currency.Dollar && subtotal > 0
              ? `~${formatTotal(discount * exchangeRate, Currency.Shekel)}`
              : undefined
          }
          amount={formatTotal(discount, currency)}
        />
      )}
      <AmountItem
        label={`${t("tax")} ${taxPercent * 100}%`}
        forex={
          currency == Currency.Dollar && subtotal > 0
            ? `~${formatTotal(tax * exchangeRate, Currency.Shekel)}`
            : undefined
        }
        amount={formatTotal(tax, currency)}
      />
      <AmountItem
        label={t("total")}
        forex={
          currency == Currency.Dollar && subtotal > 0
            ? `~${formatTotal(total * exchangeRate, Currency.Shekel)}`
            : undefined
        }
        amount={formatTotal(total, currency)}
      />
    </Paper>
  );
};

export default DocumentAmounts;
