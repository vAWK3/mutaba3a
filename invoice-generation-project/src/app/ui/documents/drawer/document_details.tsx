import {
  Drawer,
  Flex,
  Title,
  Text,
  Divider,
  Button,
  Group,
  CloseButton,
  rem,
  Box,
  ActionIcon,
  Tooltip,
  Menu,
  MenuItem,
} from "@mantine/core";
import StatusTag from "../../../../components/tags/statusTag";
import CustomFormInput from "../../../../components/form/customFormInput";
import LabelValueItem from "./label_value_item";
import NameWithAvatar from "../../../../components/clients/avatar_name";
import { useUser } from "@auth0/nextjs-auth0/client";
import { formatDate, formatTotal } from "../../../../../utilities/formatters";
import {
  IconCheck,
  IconChecklist,
  IconDownload,
  IconEye,
  IconFileCheck,
  IconFileX,
  IconSend,
} from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import DocumentItems from "./document_items";
import { useTranslations } from "next-intl";
import { ResponsiveGrid } from "../../../../components/grid/responsive_grid";
import { DocumentData } from "@/types";

interface DocumentDetailsProps {
  document?: DocumentData;
  opened: boolean;
  close: any;
}

const DocumentDetails = ({ document, opened, close }: DocumentDetailsProps) => {
  const { user, error, isLoading } = useUser();
  const isMobile = useMediaQuery("(max-width: 50em)");
  const t = useTranslations("Documents");
  const tb = useTranslations("Buttons");

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>{error.message}</div>;
  //TODO: to verify
  if (!document) return <div />;

  return (
    <Drawer
      offset={12}
      radius="md"
      opened={opened}
      onClose={close}
      position={isMobile ? "bottom" : "right"}
      size={isMobile ? "100%" : "lg"}
      withCloseButton={false}
      title={
        //TODO: Flex should have full width not 600, it's not working
        <Flex direction={"column"}>
          <Flex mb={"md"} w={600} justify={"space-between"}>
            <CloseButton onClick={close} />
            <Group mx={"lg"} gap={"xs"}>
              <Tooltip label={tb("confirm_payment")}>
                <ActionIcon color="blue" size="lg" variant="subtle">
                  <IconFileCheck />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={tb("download")}>
                <ActionIcon color="metal" size="lg" variant="subtle">
                  <IconDownload />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={tb("preview")}>
                <ActionIcon color="metal" size="lg" variant="subtle">
                  <IconEye />
                </ActionIcon>
              </Tooltip>
              <Menu>
                  <Menu.Target>
                  <Tooltip label={tb("send_again")}>

                    <ActionIcon color="metal" size="lg" variant="subtle">
                      <IconSend />
                    </ActionIcon>
                    </Tooltip>

                  </Menu.Target>
                  <Menu.Dropdown>
                    {/* Option to send to user's email */}
                    <MenuItem
                      onClick={() => {
                        // Logic to send to the user's email
                        console.log(`Sending document to ${user?.email}`);
                      }}
                    >
                      <Text fw={500}>{t("send_to_my_email")}</Text>
                      <Text fz="xs" color="dimmed">{user?.email}</Text>
                    </MenuItem>

                    {/* Divider to separate items */}
                    <Divider my="xs" />

                    {/* Option to send to client's email */}
                    <MenuItem
                      onClick={() => {
                        // Logic to send to client's email
                        console.log(`Sending document to ${document.client?.email}`);
                      }}
                    >
                      <Text fw={500}>{t("send_to_client_email")}</Text>
                      <Text fz="xs" color="dimmed">{document.client?.email}</Text>
                    </MenuItem>
                  </Menu.Dropdown>
                </Menu>
              <Tooltip label={tb("cancel")}>
                <ActionIcon color="red" size="lg" variant="subtle">
                  <IconFileX />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Flex>
          <Flex justify="space-between" align="center" w="100%" >
            <Title
              fz={"md"}
              fw={400}
              order={isMobile ? 2 : 1}
              mx={"lg"}
            >
              {t(`${document.type}`)} {document.number}
            </Title>
            <StatusTag status={document.status!} />
          </Flex>
          <Title
            fz={rem(36)}
            fw={500}
            order={isMobile ? 2 : 1}
            mx={"lg"}
            mb={"md"}
          >
            {document.subject}
          </Title>
        </Flex>
      }
      transitionProps={{
        duration: 0,
        exitDuration: 0,
        transition: isMobile ? "slide-right" : "slide-up",
      }}
      overlayProps={{ backgroundOpacity: 0.3 }}
    >

      <Flex direction="column" align="start" mx={"lg"}>
        <CustomFormInput width={"100%"}>
          <Box mb={"md"}>
            <LabelValueItem
              label={t("from")}
              value={
                <NameWithAvatar
                  color="blue"
                  name={user?.name ?? "Loading..."}
                  size="sm"
                />
              }
            />
          </Box>
          <Box mb={"md"}>
            <LabelValueItem
              label={t("to")}
              value={
                <NameWithAvatar
                  color={document.client?.color}
                  name={document.client?.name ?? ""}
                  size="sm"
                />
              }
            />
          </Box>
          <Box mb={"md"}>
            <LabelValueItem
              label={t("issue_date")}
              value={formatDate(document.issueDate)}
            />
          </Box>

          {document.dueDate && (
            <Box mb={"md"}>
              <LabelValueItem
                label={t("due_date")}
                value={formatDate(document.dueDate)}
              />
            </Box>
          )}          
          <Box mb={"md"}>
            <LabelValueItem label={t("subject")} value={document.subject} />{" "}
          </Box>
          <Box mb={"md"}>
            <LabelValueItem
              label={t("currency")}
              value={document.settings.currency!}
            />
          </Box>
          <Box mb={"md"}>
            <LabelValueItem
              label={t("discount")}
              value={
                document.discount > 0
                  ? formatTotal(document.discount, document.settings.currency!!)
                  : t("no_discount")
              }
            />
          </Box>
          <Box mb={"md"}>
            <LabelValueItem label={t("tax")} value={`${document.tax}%`} />
          </Box>
        </CustomFormInput>
        <Divider size={"sm"} c={"metal"} w={"100%"} my={"md"} />
        <DocumentItems
          items={document.items}
          currency={document.settings.currency!}
        />
        <Divider size={"sm"} c={"metal"} w={"100%"} my={"md"} />

        <ResponsiveGrid desktopSpan={[6, 6]} mobileSpan={[12]}>
          <></>
          <ResponsiveGrid desktopSpan={[6, 6]} mobileSpan={[12]}>
            <Text fw={500} size={"sm"} style={{ textAlign: "right" }}>
              {t("subtotal")}
            </Text>
            <Text
              fw={500}
              size={"sm"}
              ff={"mono"}
              style={{ textAlign: "right" }}
            >
              {formatTotal(document.subtotal, document.settings.currency!)}
            </Text>
            {document.discount > 0 && (
              <Text size={"sm"} fw={500} style={{ textAlign: "right" }}>
                {t("discount")}
              </Text>
            )}
            {document.discount > 0 && (
              <Text size={"sm"} fw={500} style={{ textAlign: "right" }}>
                {formatTotal(document.discount, document.settings.currency!)}
              </Text>
            )}

            <Text size={"sm"} fw={500} style={{ textAlign: "right" }}>{`${t(
              "tax"
            )} ${document.tax}%`}</Text>
            <Text
              size={"sm"}
              fw={500}
              ff={"mono"}
              style={{ textAlign: "right" }}
            >
              {formatTotal(
                (document.tax * (document.subtotal - document.discount)) / 100,
                document.settings.currency!
              )}
            </Text>
            <Text size={"sm"} fw={500} style={{ textAlign: "right" }}>
              {t("total")}
            </Text>

            <Text
              size={"sm"}
              fw={500}
              ff={"mono"}
              style={{ textAlign: "right" }}
            >
              {formatTotal(
                ((document.tax + 100) *
                  (document.subtotal - document.discount)) /
                  100,
                document.settings.currency!
              )}
            </Text>
          </ResponsiveGrid>
        </ResponsiveGrid>

        <Divider size={"sm"} c={"metal"} w={"100%"} my={"md"} />
        <ResponsiveGrid desktopSpan={[6, 6]} mobileSpan={[12]}>
          {<LabelValueItem label={t("sent")} value={document.client!.email} />}
          {document.notes && (
            <LabelValueItem label={t("notes")} value={document.notes} />
          )}
        </ResponsiveGrid>
      </Flex>
    </Drawer>
  );
};

export default DocumentDetails;
