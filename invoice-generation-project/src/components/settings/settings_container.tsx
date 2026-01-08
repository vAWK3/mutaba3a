import { Box, rem } from "@mantine/core";
import { ReactNode } from "react";

interface SettingsContainerProps {
  children: ReactNode | ReactNode[];
}

const SettingsContainer = ({ children }: SettingsContainerProps) => {
  return (
    <Box
      mt={{ base: "md", md: rem(30) }}
      ml={{ base: "md", md: rem(50) }}
      mr={{ base: "md", md: rem(50) }}
      pb={{ base: "xl", md: rem(30) }}
    >
      {children}
    </Box>
  );
};

export default SettingsContainer;
