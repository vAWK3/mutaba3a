import React, { useEffect, useState } from "react";
import { MultiSelect, ComboboxData } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";

interface CustomMultiSelectProps {
  key: React.Key;
  safariWidth: number | string;
  placeholder: string | undefined;
  value: string[] | undefined;
  onChange: ((value: string[]) => void) | undefined;
  data: ComboboxData;
}

const CustomMultiSelect = ({
  key,
  safariWidth,
  placeholder,
  value,
  onChange,
  data,
}: CustomMultiSelectProps) => {
  const [isSafari, setIsSafari] = useState(false);

  useEffect(() => {
    const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(
      navigator.userAgent
    );
    setIsSafari(isSafariBrowser);
  }, []);

  return (
    <MultiSelect
      key={key}
      w={isSafari ? { safariWidth } : undefined}
      rightSection={<IconChevronDown size={16} />}
      data={data}
      placeholder={placeholder}
      checkIconPosition="right"
      value={value}
      onChange={onChange}
    />
  );
};

export default CustomMultiSelect;
