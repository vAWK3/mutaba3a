import { Flex, Box, Center, Tooltip } from "@mantine/core";
import { IconInfoCircleFilled } from "@tabler/icons-react";

interface ProfileInputProps {
  tipText?: string;
  children: React.ReactNode[] | React.ReactNode;
}

const ProfileInput = ({ tipText, children }: ProfileInputProps) => {
  return (
    <Flex align={"flex-end"} justify={"center"} mt={"sm"} w={"100%"}>
      {children}
      <Box mb={"xs"} w={48}>
        {tipText && (
          <Tooltip label={tipText} multiline w={220}>
            <Center>
              <IconInfoCircleFilled />
            </Center>
          </Tooltip>
        )}
      </Box>
    </Flex>
  );
};

export default ProfileInput;
