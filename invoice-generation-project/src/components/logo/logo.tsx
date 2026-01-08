import { Flex, Group, Image } from "@mantine/core";

interface LogoProps {
  width?: number | string;
  wordmark?: boolean;
  icon?: boolean;
  placement?: "right" | "under" | "left";
  expanded?: boolean;
}

const Logo: React.FC<LogoProps> = ({
  width = "50%",
  wordmark = false,
  icon = true,
  placement = "right",
  expanded = false,
}) => {
  const wordmarkSrcBlack =
    "/logo/logo_type_black.svg";

  const wordmarkSrcWhite = "/logo/logo_type_white.svg";

  const logo = expanded ? (
    <Image
      src="/logo/logo_horizontal.svg"
      alt="Fatura"
      w={width}
      h={"auto"}
      fit="contain"
    />
  ) : (
    <Group>
      {icon && (
        <Image
          src="/logo/logo_icon.svg"
          alt="Fatura Icon"
          h={"auto"}
          w={width}
          fit="contain"
        />
      )}
      {wordmark && (
        <Image
          src={wordmarkSrcBlack}
          alt="Fatura Wordmark"
          h={"auto"}
          w={width}
          fit="contain"
          className="dark:hidden"
        />
      )}
      {wordmark && (
        <Image
          src={wordmarkSrcWhite}
          alt="Fatura Wordmark"
          h={"auto"}
          w={width}
          fit="contain"
          className="hidden dark:block"
        />
      )}
    </Group>
  );

  return logo;
};

export default Logo;
