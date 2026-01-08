import { Text } from "@mantine/core";
import { ResponsiveGrid } from "../grid/responsive_grid";

interface FormInputProps {
  width: string | number;
  children: React.ReactNode[];
  title?: string;
}

const CustomFormInput = ({ width, children, title }: FormInputProps) => {
  return (
    <>
      {title && (
        <Text mt={"xl"} fz={"lg"}>
          {title}
        </Text>
      )}
      <ResponsiveGrid desktopSpan={[6, 6]} mobileSpan={[12]}>
        {children}
      </ResponsiveGrid>
    </>
  );
};

export default CustomFormInput;
