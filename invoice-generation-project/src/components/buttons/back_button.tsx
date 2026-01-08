import { Button } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

interface ButtonProps {
  withIcon?: React.ReactNode;
  onClick?: any;
  href?: string;
  variant?: string;
  size?: string;
}

const BackButton = ({
  variant = "default",
  size = "md",
  href,
  withIcon,
  onClick,
}: ButtonProps) => {
  const t = useTranslations("Buttons");

  return href != null ? (
    <Button
      variant={variant}
      size={size}
      fw={"400"}
      leftSection={withIcon ? <IconArrowLeft /> : <></>}
      onClick={onClick}
      component={Link}
      href={href!}
    >
      {t("back")}
    </Button>
  ) : (
    <Button
      variant={variant}
      size={size}
      fw={"400"}
      leftSection={withIcon ? <IconArrowLeft /> : <></>}
      onClick={onClick}
    >
      {t("back")}
    </Button>
  );
};

export default BackButton;
