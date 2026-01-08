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
  Divider,
  Menu,
  MenuItem,
  Select,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";

import { parseStringToNumber } from "../../../../utilities/formatters";
import { useTranslations } from "next-intl";
import classes from "@styles/Common.module.css";
import {
  Currency,
  DocumentData,
  DocumentPayment,
  PaymentMethod,
} from "@/types";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import { UseFormReturnType } from "@mantine/form";

interface PaymentMethodProps extends PaperProps {
  onTotalChange: (total: number) => void;
  onItemsChange: (items: DocumentPayment[]) => void;
  document: DocumentData;
  form: UseFormReturnType<DocumentData>;
}

export interface ItemErrors {
  amount: boolean;
  details: boolean;
}

const PaymentMethodSelector: React.FC<any> = ({
  onTotalChange,
  onItemsChange,
  document,
  form,
  ...props
}: PaymentMethodProps) => {
  const t = useTranslations("Documents");

  const [lastItemError, setLastItemError] = useState<ItemErrors>({
    amount: false,
    details: false,
  });

  const [items, setItems] = useState<DocumentPayment[]>(document.payment ?? []);

  const initialCurrency = document.settings.currency ?? Currency.Shekel;
  // const [currency, setCurrency] = useState<string>(initialCurrency);

  const handleAddItem = (paymentMethod: PaymentMethod) => {
    const lastItem = items[items.length - 1];

    const newError = {
      amount: false,
      details: false,
    };

    if (lastItem) {
      if (!lastItem.amount) {
        newError.amount = true;
      }

      if (!lastItem.details) {
        newError.details = true;
      }
    }

    if (!newError.amount && !newError.details) {
      //TODO: show dropdown to select payment method

      setItems([
        ...items,
        {
          amount: 0,
          currency: initialCurrency,
          method: paymentMethod,
          details: {},
        },
      ]);
      onItemsChange(items);
    }

    setLastItemError(newError);
  };

  const handleDeleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);

    let total = 0;

    newItems.forEach((item) => {
      total += item.amount;
    });

    onTotalChange(total);
    onItemsChange(newItems);
    setItems(newItems);
  };

  const handleInputChange = (
    index: number,
    field: keyof DocumentPayment | string,
    value: string
  ) => {
    const updatedItems = [...items];

    if (field == "amount") {
      const numberValue = parseStringToNumber(value) ?? 0;
      updatedItems[index][field] = numberValue;
    } else if (field == "notes" || field == "currency") {
      updatedItems[index][field] = value;
    } else {
      updatedItems[index]["details"][field] = value;
    }

    setItems(updatedItems);
    if (field == "amount") {
      let total = 0;

      items.forEach((item) => {
        total += item.amount;
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
              errors={
                index == items.length - 1 || index == 0
                  ? lastItemError
                  : undefined
              }
              handleDeleteItem={handleDeleteItem}
              handleInputChange={handleInputChange}
              form={form}
            />
          </div>
        );
      })}

      <Menu>
        <Menu.Target>
          <Button
            variant="light"
            leftSection={<IconPlus stroke={1} />}
            fw={400}
          >
            {t("add_payment")}
          </Button>
        </Menu.Target>

        <Menu.Dropdown>
          {Object.keys(PaymentMethod).map((item, index) => {
            return (
              <MenuItem
                key={index}
                onClick={() =>
                  handleAddItem(
                    PaymentMethod[item as keyof typeof PaymentMethod]
                  )
                }
              >
                <Text fz={"xs"}>
                  {t(`${PaymentMethod[item as keyof typeof PaymentMethod]}`)}
                </Text>
              </MenuItem>
            );
          })}
        </Menu.Dropdown>
      </Menu>
    </Paper>
  );
};

const ItemInputField = ({
  item,
  index,
  form,
  errors,
  handleInputChange,
  handleDeleteItem,
}: {
  item: DocumentPayment;
  index: number;
  form: UseFormReturnType<DocumentData>;
  errors: ItemErrors | undefined;
  handleDeleteItem: (index: number) => void;
  handleInputChange: (
    index: number,
    field: keyof DocumentPayment | string,
    value: string
  ) => void;
}) => {
  const t = useTranslations("Documents");
  const tf = useTranslations("Form");

  const children = [];

  if (item.method != PaymentMethod.BANK) {
    children.push(
      <TextInput label={t("payment")} value={t(`${item.method}`)} disabled />
    );
  }

  if (item.method == PaymentMethod.BANK) {
    children.push(
      <TextInput
        label={t("bank")}
        value={item.details["bank"] ?? ""}
        error={
          (index == 0 && form.getInputProps("payments").error) ??
          ((errors?.details ?? false) && tf("bank_err"))
        }
        onChange={(e) => handleInputChange(index, "bank", e.target.value)}
      />
    );
    children.push(
      <TextInput
        label={t("branch")}
        value={item.details["branch"] ?? ""}
        error={
          (index == 0 && form.getInputProps("payments").error) ??
          ((errors?.details ?? false) && tf("branch_err"))
        }
        onChange={(e) => handleInputChange(index, "branch", e.target.value)}
      />
    );
    children.push(
      <TextInput
        label={t("account")}
        value={item.details["account"] ?? ""}
        error={
          (index == 0 && form.getInputProps("payments").error) ??
          ((errors?.details ?? false) && tf("account_err"))
        }
        onChange={(e) => handleInputChange(index, "account", e.target.value)}
      />
    );
  } else if (item.method == PaymentMethod.CASH) {
  } else if (item.method == PaymentMethod.CHEQUE) {
  } else if (item.method == PaymentMethod.CREDIT) {
  } else if (item.method == PaymentMethod.OTHER) {
  }

  return (
    <ResponsiveGrid
      w={"100%"}
      key={index}
      align="center"
      mb={"sm"}
      justify="center"
      desktopSpan={[11, 1]}
      mobileSpan={[11, 1]}
    >
      <ResponsiveGrid desktopSpan={[3, 3, 3, 3]} mobileSpan={[6, 6, 6, 6]}>
        {...children}
        <Select
          label={t("currency")}
          allowDeselect={false}
          onChange={(value) => {
            if (value) {
              // const c = Currency[value as keyof typeof Currency];
              handleInputChange(index, "currency", value);
            }
          }}
          // value={Currency[item.currency as keyof typeof Currency]}
          value={item.currency}
          data={Object.keys(Currency).map((item) => ({
            value: Currency[item as keyof typeof Currency],
            label: item,
          }))}
        />
        <NumberInput
          label={t("amount")}
          allowNegative={false}
          allowDecimal={true}
          decimalScale={2}
          decimalSeparator="."
          thousandSeparator=","
          value={item.amount}
          fixedDecimalScale
          hideControls
          prefix={item.currency}
          min={0}
          onChange={(e) => handleInputChange(index, "amount", e.toString())}
        />
        <TextInput
          label={t("notes_lbl")}
          placeholder={t("notes_ph")}
          value={item.notes}
          onChange={(e) => handleInputChange(index, "notes", e.target.value)}
        />
      </ResponsiveGrid>
      <Center>
        <ActionIcon
          mt={rem(16)}
          color="red"
          onClick={() => handleDeleteItem(index)}
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Center>
    </ResponsiveGrid>
  );
};

export default PaymentMethodSelector;
