"use client";

import { useState } from "react";
import {
  Paper,
  Text,
  TextInput,
  Button,
  ActionIcon,
  Center,
  rem,
  NumberInput,
  PaperProps,
  Checkbox,
  Divider,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";

import { parseStringToNumber } from "../../../../utilities/formatters";
import { useTranslations } from "next-intl";
import classes from "@styles/Common.module.css";
import { DocumentData, DocumentItem } from "@/types";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import { UseFormReturnType } from "@mantine/form";

interface DocumentItemsProps extends PaperProps {
  onTotalChange: (total: number) => void;
  onItemsChange: (items: DocumentItem[]) => void;
  document: DocumentData;
  form: UseFormReturnType<DocumentData>;
  taxPercent: number;
}

export interface ItemErrors {
  name: boolean;
  quantity: boolean;
}

const ItemGenerator: React.FC<any> = ({
  onTotalChange,
  onItemsChange,
  document,
  taxPercent,
  form,
  ...props
}: DocumentItemsProps) => {
  const t = useTranslations("Documents");

  const [lastItemError, setLastItemError] = useState<ItemErrors>({
    name: false,
    quantity: false,
  });

  const [items, setItems] = useState<DocumentItem[]>(
    document.items.length > 0
      ? document.items
      : [
        {
          name: "",
          quantity: 0,
          rate: 0,
          discount: 0,
          taxExempt: false,
          rateVat: 0,
        },
      ]
  );

  const handleAddItem = () => {

    const lastItem = items[items.length - 1];

    const newError = {
      name: false,
      quantity: false,
    };

    if (!lastItem.name) {
      newError.name = true;
    }

    if (!lastItem.quantity) {
      newError.quantity = true;
    }

    if (!newError.name && !newError.quantity) {
      setItems([
        ...items,
        {
          name: "",
          quantity: 0,
          rate: 0,
          discount: 0,
          taxExempt: false,
          rateVat: 0,
        },
      ]);
      onItemsChange(items);
    }

    setLastItemError(newError);
  };

  const handleDeleteItem = (index: number) => {
    if (items.length == 1) {
      const newItems = [
        {
          name: "",
          quantity: 0,
          rate: 0,
          rateVat: 0,
          discount: 0,
          taxExempt: false,
        },
      ];
      setItems(newItems);
      onItemsChange(newItems);
      return;
    }

    const newItems = items.filter((_, i) => i !== index);

    let total = 0;

    newItems.forEach((item) => {
      total += item.quantity * item.rate;
    });

    onTotalChange(total);
    onItemsChange(newItems);
    setItems(newItems);
  };

  const handleInputChange = (
    index: number,
    field: keyof DocumentItem,
    value: string
  ) => {
    const updatedItems = [...items];
    if (field == "rate" || field == "rateVat") {
      const numberValue = parseStringToNumber(value) ?? 0;

      if (field == "rate") {
        updatedItems[index]["rate"] = numberValue;
        updatedItems[index]["rateVat"] = numberValue * (1 + taxPercent);
      } else {
        updatedItems[index]["rateVat"] = numberValue;
        updatedItems[index]["rate"] = numberValue / (1 + taxPercent);
      }
    } else if (field == "taxExempt") {
      updatedItems[index][field] = value == "true";
      updatedItems[index]["rateVat"] =
        updatedItems[index]["rate"] * (1 + (value == "true" ? 0 : taxPercent));
    } else if (field == "quantity" || field == "discount") {
      updatedItems[index][field] = parseStringToNumber(value) ?? 0;
    } else {
      updatedItems[index][field] = value;
    }
    setItems(updatedItems);
    if (field == "rate" || field == "quantity") {
      let total = 0;

      items.forEach((item) => {
        total += item.quantity * item.rate;
      });

      onTotalChange(total);
    }

    onItemsChange(items);
  };

  return (
    <Paper
      w={"100%"}
      className={classes.container}
      radius={4}
      m={0}
      p={"md"}
      {...props}
    >
      {items.map((item, index) => {
        return (
          <div key={index}>
            {index > 0 && <Divider my={"lg"} />}
            <ItemInputField
              item={item}
              index={index}
              currency={document.settings?.currency ?? ""}
              errors={
                index == items.length - 1 || index == 0
                  ? lastItemError
                  : undefined
              }
              tax={0.17}
              handleDeleteItem={handleDeleteItem}
              handleInputChange={handleInputChange}
              form={form}
            />
          </div>
        );
      })}

      <Button
        variant="light"
        leftSection={<IconPlus stroke={1} />}
        fw={400}
        onClick={handleAddItem}
      >
        {t("add_item")}
      </Button>
    </Paper>
  );
};

const ItemInputField = ({
  item,
  index,
  currency,
  errors,
  form,
  handleInputChange,
  handleDeleteItem,
}: {
  item: DocumentItem;
  index: number;
  tax: number;
  currency: string;
  form: UseFormReturnType<DocumentData>;
  errors: ItemErrors | undefined;
  handleDeleteItem: (index: number) => void;
  handleInputChange: (
    index: number,
    field: keyof DocumentItem,
    value: string
  ) => void;
}) => {
  const t = useTranslations("Documents");
  const tf = useTranslations("Form");

  return (
    <ResponsiveGrid
      w={"100%"}
      key={index}
      align="center"
      mb={"sm"}
      justify="center"
      desktopSpan={[6, 2, 3, 1, 6, 2, 3, 1]}
      mobileSpan={[
        6,
        index == 0 ? 6 : 5,
        index == 0 ? 6 : 5,
        2,
        6,
        index == 0 ? 6 : 5,
        index == 0 ? 6 : 5,
        2,
      ]}
    >
      <TextInput
        label={t("item")}
        value={item.name}
        error={
          (index == 0 && form.getInputProps("items").error) ??
          ((errors?.name ?? false) && tf("name_err"))
        }
        onChange={(e) => handleInputChange(index, "name", e.target.value)}
      />

      <NumberInput
        label={t("quantity")}
        allowNegative={false}
        allowDecimal={true}
        decimalScale={2}
        fixedDecimalScale
        decimalSeparator="."
        thousandSeparator=","
        value={item.quantity}
        error={errors?.quantity ?? false}
        min={0}
        onChange={(e) => handleInputChange(index, "quantity", e.toString())}
      />

      <NumberInput
        label={t("rate")}
        allowNegative={false}
        allowDecimal={true}
        decimalScale={2}
        decimalSeparator="."
        thousandSeparator=","
        value={item.rate}
        fixedDecimalScale
        hideControls
        prefix={currency}
        min={0}
        onChange={(e) => handleInputChange(index, "rate", e.toString())}
      />

      <Center>
        <ActionIcon
          mt={rem(16)}
          color="red"
          onClick={() => handleDeleteItem(index)}
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Center>

      <Checkbox
        label={t("vat_exempt")}
        checked={item.taxExempt}
        onChange={(e) =>
          handleInputChange(
            index,
            "taxExempt",
            e.currentTarget.checked ? "true" : "false"
          )
        }
      />

      <NumberInput
        label={t("discount")}
        allowNegative={false}
        allowDecimal={true}
        decimalScale={2}
        decimalSeparator="."
        thousandSeparator=","
        value={item.discount}
        fixedDecimalScale
        hideControls
        prefix={currency}
        min={0}
        onChange={(e) => handleInputChange(index, "discount", e.toString())}
      />
      <NumberInput
        label={t("rate_vat")}
        allowNegative={false}
        allowDecimal={true}
        decimalScale={2}
        decimalSeparator="."
        thousandSeparator=","
        value={item.rateVat}
        fixedDecimalScale
        hideControls
        prefix={currency}
        min={0}
        onChange={(e) => handleInputChange(index, "rateVat", e.toString())}
      />
      <span></span>
    </ResponsiveGrid>
  );
};

export default ItemGenerator;
