"use client";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import { TextInput, Select, GridProps, Textarea } from "@mantine/core";

import { useTranslations } from "next-intl";
import { DateInput } from "@mantine/dates";
import { IconCalendar } from "@tabler/icons-react";
import { DocumentData, Language } from "@/types";
import { useState } from "react";
import { getNameForLanguage } from "../../../../utilities/languageChange";
import { UseFormReturnType } from "@mantine/form";

interface DocInfoProps extends GridProps {
  document: DocumentData;
  onUpdateDocument: (document: DocumentData) => void;
  form: UseFormReturnType<DocumentData>;
  type: string;
  withBrief: boolean;
  withDueDate: boolean;
}

const DocInfo = ({
  form,
  document,
  type,
  withBrief,
  withDueDate,
  onUpdateDocument,
  ...props
}: DocInfoProps) => {
  const t = useTranslations("Documents");
  const tf = useTranslations("Form");

  const [subject, setSubject] = useState<string>(document.subject ?? "");
  const [brief, setBrief] = useState<string>(document.brief ?? "");
  const [issueDate, setIssueDate] = useState<Date | null>(document.issueDate);
  const [dueDate, setDueDate] = useState<Date | undefined | null>(
    document.dueDate
  );

  const initialLanguage =
    document.settings.language == Language.ar
      ? "ar"
      : document.settings.language == Language.he
      ? "he"
      : "en";

  const [language, setLanguage] = useState<string>(initialLanguage);

  return (
    <ResponsiveGrid
      desktopSpan={[6, withBrief ? 12 : 6, withDueDate ? 6 : 12, 6]}
      mobileSpan={[12]}
      {...props}
    >
      <TextInput
        label={t("subject")}
        placeholder={tf("subject_ph")}
        value={subject}
        onChange={(e) => {
          const sub = e.currentTarget.value;
          setSubject(sub);
          onUpdateDocument({ ...document, subject: sub });
        }}
        error={form.getInputProps("subject").error}
      />
      {withBrief && (
        <Textarea
          label={t("brief_lbl")}
          placeholder={t("brief_ph")}
          value={brief}
          onChange={(e) => {
            const sub = e.currentTarget.value;
            setBrief(sub);
            onUpdateDocument({ ...document, brief: sub });
          }}
        />
      )}
      <DateInput
        label={t("issue_date")}
        rightSection={<IconCalendar />}
        value={issueDate}
        error={form.getInputProps("issueDate").error}
        onChange={(value) => {
          setIssueDate(value);
          if (value) {
            const newValue = new Date(value);
            onUpdateDocument({ ...document, issueDate: newValue });
          }
        }}
      />
      {withDueDate && (
        <DateInput
          label={t("due_date")}
          error={form.getInputProps("dueDate").error}
          rightSection={<IconCalendar />}
          value={dueDate}
          onChange={(value) => {
            setDueDate(value);
            if (value) {
              const newValue = new Date(value);
              onUpdateDocument({ ...document, dueDate: newValue });
            }
          }}
        />
      )}
      <Select
        label={t("language", {
          type: type,
        })}
        data={Object.keys(Language).map((item) => {
          return {
            value: item,
            label: Language[item as keyof typeof Language],
          };
        })}
        value={language}
        onChange={(value) => {
          if (!value) {
            return;
          }

          const newLang = Language[value as keyof typeof Language];

          setLanguage(value);

          const oldSettings = document.settings;

          onUpdateDocument({
            ...document,
            settings: { ...oldSettings, language: newLang },
          });
        }}
      />
    </ResponsiveGrid>
  );
};

export default DocInfo;
