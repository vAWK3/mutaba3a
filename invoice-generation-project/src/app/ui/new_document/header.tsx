import { Button, ActionIcon } from "@mantine/core";
import {
  IconUpload,
  IconArrowLeft,
  IconArrowRight,
  IconSend,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";

interface HeaderProps {
  type: string | undefined;
  onSaveDraft: () => void;
}

export const Header = ({ type, onSaveDraft }: HeaderProps) => {
  const t = useTranslations("Documents");

  return [
    <Button
      key={"draft"}
      variant="outline"
      color={"metal"}
      fw={500}
      visibleFrom="sm"
      onClick={onSaveDraft}
      leftSection={<IconUpload />}
    >
      {t("save_draft")}
    </Button>,
    <ActionIcon
      hiddenFrom="sm"
      variant="outline"
      color={"metal"}
      key={"sm_draft"}
      onClick={onSaveDraft}
    >
      <IconUpload size={16} />
    </ActionIcon>,
    <Button
      key={"submit"}
      className="flex items-center flex-row-reverse"
      visibleFrom="sm"
      type="submit"
      //   onClick={onSubmit}
    >
      {type &&
        t("send", {
          type: t(`${type}`),
        })}
      <IconArrowLeft size={"18px"} className="ltr:hidden" />
      <IconArrowRight size={"18px"} className="rtl:hidden" />
    </Button>,
    <ActionIcon
      hiddenFrom="sm"
      key={"sm_submit"}
      type="submit"
      //   onClick={onSubmit}
    >
      <IconSend size={16} />
    </ActionIcon>,
  ];
};
