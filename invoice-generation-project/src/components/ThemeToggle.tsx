"use_client";

import { useContext } from "react";
import ThemeContext from "../contexts/ThemeContext";

import {
  Button,
  Group,
  MantineColorScheme,
  Select,
  SelectProps,
  useMantineColorScheme,
} from "@mantine/core";
import { IconAlignRight, IconCheck, IconChevronDown, IconDeviceImac, IconMoonStars, IconSun } from "@tabler/icons-react";

const ThemeToggle = () => {
  const { setColorScheme } = useMantineColorScheme();

  const context = useContext(ThemeContext);
  const iconProps = {
    stroke: 1.5,
    color: 'currentColor',
    opacity: 0.6,
    size: 18,
  };
  const icons: Record<string, React.ReactNode> = {
    light: <IconSun {...iconProps} />,
    dark: <IconMoonStars {...iconProps} />,
    auto: <IconDeviceImac {...iconProps} />,
  };

  if (!context) {
    throw new Error("ThemeToggle must be used within a ThemeProvider");
  }

  const renderSelectOption: SelectProps['renderOption'] = ({ option, checked }) => (
    <Group flex="1" gap="xs">
      {icons[option.value]}
      {option.label}
      {checked && <IconCheck style={{ marginInlineStart: 'auto' }} {...iconProps} />}
    </Group>
  );
  

  const { theme, toggleTheme } = context;

  return (
    <Select
      allowDeselect={false}
      checkIconPosition="right"
      onChange={(_value, option) => {
        setColorScheme(option.value as MantineColorScheme);
        toggleTheme(option.value);
      }}
      defaultValue={theme}
      variant="default"
      data={[
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'auto', label: 'Auto' },
      ]}
      renderOption={renderSelectOption}
    />
    // <Group justify="center" mt="xl">
    //   <Button
    //     onClick={() => {
    //       setColorScheme("light");
    //       toggleTheme("light");
    //     }}
    //   >
    //     Light
    //   </Button>
    //   <Button
    //     onClick={() => {
    //       setColorScheme("dark");
    //       toggleTheme("dark");
    //     }}
    //   >
    //     Dark
    //   </Button>
    //   <Button
    //     onClick={() => {
    //       setColorScheme("auto");
    //       toggleTheme("auto");
    //     }}
    //   >
    //     Auto
    //   </Button>
    // </Group>
    // <button onClick={toggleTheme}>
    //   Switch to {theme === 'light' ? 'Dark' : 'Light'} Mode
    // </button>
  );
};

export default ThemeToggle;
