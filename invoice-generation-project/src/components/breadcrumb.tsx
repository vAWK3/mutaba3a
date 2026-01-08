import { Breadcrumbs, Anchor, Group, useMantineTheme } from "@mantine/core";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl"; // Import the useTranslations hook
import { useContext } from "react";
import { ProfileContext } from "@/contexts/ProfileContext";

interface BreadcrumbProps {
  removeLastPath?: boolean;
}

const Breadcrumb = ({ removeLastPath }: BreadcrumbProps) => {
  const pathname = usePathname();
  let BreadcrumbsArray = pathname?.split("/");
  BreadcrumbsArray?.shift();
  const theme = useMantineTheme(); // Access Mantine theme for color adjustments
  const t = useTranslations("Breadcrumbs"); // Initialize translations
  const profiles = useContext(ProfileContext);

  if (!BreadcrumbsArray) {
    return <></>;
  }

  if (removeLastPath) {
    BreadcrumbsArray = BreadcrumbsArray.filter((item) => !/^\d+$/.test(item));
  }

  const bcs = BreadcrumbsArray.map((item, index) => (
    <Anchor
      c={
        index == BreadcrumbsArray.length - 1
          ? theme.colors.metal[5]
          : theme.colors.metal[7]
      }
      href={
        index == BreadcrumbsArray.length - 1
          ? "#"
          : "/" + BreadcrumbsArray.slice(0, index + 1).join("/")
      }
      key={index}
    >
      {t(item) || item.charAt(0).toUpperCase() + item.slice(1)}
    </Anchor>
  ));

  if (!BreadcrumbsArray.includes("dashboard")) {
    {
      //TODO: update dashboard link to profile id
    }
    bcs.unshift(
      <Anchor href={`${profiles?.activeProfile?.id}/dashboard`} key={148} c={theme.colors.metal[4]}>
        {t("dashboard") || "dashboard"} {/* Translate workspace */}
      </Anchor>
    );
  }

  return <Breadcrumbs visibleFrom="sm">{bcs}</Breadcrumbs>;
};

export default Breadcrumb;
