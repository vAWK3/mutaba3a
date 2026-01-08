import { ColorSwatch, CheckIcon, Flex, ScrollArea } from "@mantine/core";

import { useState } from "react";

interface ColorPickerProps {
  defaultIndex?: number;
  colors: string[];
  onSelect: (color: string) => void;
}

const CustomColorPicker = ({ colors, onSelect, defaultIndex }: ColorPickerProps) => {
  const [pickedColor, setPickedColor] = useState<number>(defaultIndex ?? 0);

  return (
    <ScrollArea>
      <Flex gap={"lg"} w={"100%"}>
        {colors.map((item, index) => {
          return (
            <ColorSwatch
              key={index}
              // component="button"
              onClick={() => {
                setPickedColor(index);
                onSelect(item);
              }}
              color={item}
            >
              {pickedColor == index && (
                <CheckIcon width={12} height={12} color="black" />
              )}
            </ColorSwatch>
          );
        })}
      </Flex>
    </ScrollArea>
  );
};

export default CustomColorPicker;
