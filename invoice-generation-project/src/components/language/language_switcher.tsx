"use client";

import { useLocale, useTranslations } from "next-intl";
import LocaleSwitcherSelect from "./language_switcher_select";

interface LocaleSwitcherProps {
  iconOnly: boolean;
}

export default function LocaleSwitcher({ iconOnly }: LocaleSwitcherProps) {
  const t = useTranslations("LocaleSwitcher");
  const locale = useLocale();

  return (
    <LocaleSwitcherSelect
      defaultValue={locale}
      items={[
        {
          value: "en",
          label: t("en"),
        },
        {
          value: "ar",
          label: t("ar"),
        },
      ]}
      iconOnly={iconOnly}
    />
  );
}
