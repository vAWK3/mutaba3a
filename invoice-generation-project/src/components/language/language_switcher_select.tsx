"use client";

import { useTransition } from "react";
import { Locale } from "@/i18n/config";
import { setUserLocale } from "@/services/locale";
import { LoadingOverlay, Select, useDirection } from "@mantine/core";
import { IconChevronDown, IconWorld } from "@tabler/icons-react";

type Props = {
  defaultValue: string;
  items: Array<{ value: string; label: string }>;
  iconOnly: boolean;
};

export default function LocaleSwitcherSelect({
  defaultValue,
  items,
  iconOnly,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const { toggleDirection } = useDirection();

  function onChange(value: string) {
    const locale = value as Locale;
    toggleDirection();
    startTransition(() => {
      setUserLocale(locale);
    });
  }

  return isPending ? (
    <LoadingOverlay />
  ) : iconOnly ? (
    <IconWorld onClick={() => onChange(defaultValue == "ar" ? "en" : "ar")} />
  ) : (
    <Select
      allowDeselect={false}
      onChange={(_value, option) => onChange(option.value)}
      defaultValue={defaultValue}
      variant="default"
      checkIconPosition="right"
      data={items}
    />
  );
}
