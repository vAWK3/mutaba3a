import React from "react";
import { Badge, Text, Tooltip } from "@mantine/core";
import { useTranslations } from "next-intl";
import classes from "./StatusTag.module.css";
import { DocumentStatus } from "@/types";
import { formatDate } from "../../../utilities/formatters";


interface StatusTagProps {
  status: DocumentStatus;
  dueDate?: Date;  // Optional due date
  paidDate?: Date; // Optional paid date
  size?: string;
}

const StatusTag: React.FC<StatusTagProps> = ({
  status,
  size = "sm",
  dueDate,
  paidDate,  
}: StatusTagProps) => {
  const t = useTranslations("Documents");

  
  const getTooltipText = () => {
    switch (status) {
      case DocumentStatus.Overdue:
        return `${t("due_date")}: ${dueDate ? formatDate(dueDate) : "N/A"}`;
      case DocumentStatus.Pending:
        return `${t("due_date")}: ${dueDate ? formatDate(dueDate) : "N/A"}`;
      case DocumentStatus.Paid:
        return `${t("paid_date")}: ${paidDate ? formatDate(paidDate) : "N/A"}`;
      default:
        return "";
    }
  };

  return (
    <Tooltip label={getTooltipText()} withArrow>
      <Badge
        autoContrast
        className={
          status == DocumentStatus.Paid
            ? classes.paid
            : status == DocumentStatus.Overdue
            ? classes.overdue
            : classes.pending
        }
        p={size}
        fz={size}
        tt={"none"}
        m={size}
      >
        <Text
          size={size}
          fw={500}
          className={
            status == DocumentStatus.Paid
              ? classes.paid
              : status == DocumentStatus.Overdue
              ? classes.overdue
              : classes.pending
          }
        >
          {t(`${status}`)}
        </Text>
      </Badge>
    </Tooltip>
  );
};

export default StatusTag;
