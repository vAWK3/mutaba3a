"use client";
import {
  Group,
  ActionIcon,
  Box,
  Menu,
  MenuTarget,
  Text,
  MenuDropdown,
  MenuItem,
  Tooltip,
  Divider,
} from "@mantine/core";
import {
  IconCheck,
  IconMailForward,
  IconDownload,
  IconDots,
  IconSend,
  IconFileCheck,
} from "@tabler/icons-react";
import { isDocumentCompletable } from "../../../../models/table_document";
import { useRouter } from "next/navigation";
import { DocumentData, IssuedDocumentType } from "@/types";
import { useTranslations } from "next-intl";
import { useUser } from "@auth0/nextjs-auth0/client";

interface ActionProps {
  document: DocumentData;
}

const DocumentActions = ({ document }: ActionProps) => {
  const router = useRouter();
  const t = useTranslations("Documents");
  const tb = useTranslations("Buttons");
  const { user } = useUser();

  const confirmPayment = () => {
    router.push(
      `/create/${document.clientId}?type=${IssuedDocumentType.Receipt}&client=${document.client?.name}`
    );
  };

  return (
    <>
      <Group justify="flex-end" visibleFrom="sm" gap={"3px"}>
        {isDocumentCompletable(document.type, document.status!) ? (
          <Tooltip label="Confirm payment">
            <ActionIcon
              visibleFrom="lg"
              variant="subtle"
              color="metal"
              size="lg"

              // onClick={confirmPayment}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                confirmPayment();
              }}
            >
              <IconFileCheck />
            </ActionIcon>
          </Tooltip>
        ) : (
          <ActionIcon
            visibleFrom="lg"
            c="transparent"
            disabled
            bg="transparent"
          ></ActionIcon>
        )}
        <Box
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation(); // Prevents the document details from opening
          }}
        >
          <Menu>
            <Menu.Target>
              <Tooltip label={tb("send_again")}>
                <ActionIcon
                  visibleFrom="lg"
                  color="metal"
                  size="lg"
                  variant="subtle"
                >
                  <IconSend />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>

            <Menu.Dropdown>
              {/* Option to send to user's email */}
              <MenuItem
                onClick={() => {
                  console.log(`Sending document to ${user?.email}`);
                }}
              >
                <Text fw={500}>{t("send_to_my_email")}</Text>
                <Text fz="xs" color="dimmed">
                  {user?.email}
                </Text>
              </MenuItem>

              <Divider my="xs" />

              {/* Option to send to client's email */}
              <MenuItem
                onClick={() => {
                  console.log(`Sending document to ${document.client?.email}`);
                }}
              >
                <Text fw={500}>{t("send_to_client_email")}</Text>
                <Text fz="xs" color="dimmed">
                  {document.client?.email}
                </Text>
              </MenuItem>
            </Menu.Dropdown>
          </Menu>
        </Box>
        <Tooltip label={tb("download")}>
          <ActionIcon
            visibleFrom="lg"
            key="download"
            size="lg"
            variant="subtle"
            c="metal"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
            }}
          >
            <IconDownload />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box hiddenFrom="sm">
        <Menu>
          <MenuTarget>
            <ActionIcon
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
              }}
              key="more"
              variant="outline"
              bd="transparent"
              c="metal"
            >
              <IconDots />
            </ActionIcon>
          </MenuTarget>
          <MenuDropdown>
            {isDocumentCompletable(document.type, document.status!) && (
              <MenuItem
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  confirmPayment();
                }}
                //    onClick={confirmPayment}
              >
                <Text>{t("confirm_payment")}</Text>
              </MenuItem>
            )}
            <MenuItem
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
              }}
            >
              <Text>{t("send_to_client")}</Text>
            </MenuItem>
            <MenuItem
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
              }}
            >
              <Text>
                {t("download", {
                  type: document.type,
                })}
              </Text>
            </MenuItem>
          </MenuDropdown>
        </Menu>
      </Box>
    </>
  );
};

export default DocumentActions;
