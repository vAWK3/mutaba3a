"use client";

import React, { createContext, useContext, useState } from "react";

import { Button, Flex, Grid, Modal, Text } from "@mantine/core";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import SettingsModal from "@/app/ui/settings/modal";
import DocumentDetails from "@/app/ui/documents/drawer/document_details";

export enum ModalType {
  Changes,
  Settings,
  Document,
  SendDocument,
  Custom,
}

// Define the context
const ModalContext = createContext({
  openModal: (modalType: ModalType, modalProps?: any) => { },
  closeModal: () => { },
});

// Modal provider
export const ModalProvider = ({ children }: { children: React.ReactNode }) => {
  const [modalType, setModalType] = useState<ModalType | null>(null);
  const [modalProps, setModalProps] = useState<any>({});
  const router = useRouter();
  const t = useTranslations("Modals");

  const openModal = (type: ModalType, props: any = {}) => {
    setModalType(type);
    setModalProps(props);
  };

  const closeModal = () => {
    setModalType(null);
    setModalProps({});
  };
  const locale = useLocale(); // Get the current locale

  return (
    <ModalContext.Provider value={{ openModal, closeModal }}>
      {children}
      {/* Add reusable modals here */}
      <SettingsModal
        isOpen={modalType == ModalType.Settings}
        onClose={closeModal}
        defaultTab={modalProps.defaultTab}
      />
      <DocumentDetails
        opened={modalType === ModalType.Document}
        close={closeModal}
        document={modalProps.document}
      />
      <Modal
        opened={modalType === ModalType.Custom}
        onClose={closeModal}
        fullScreen
      >
        {modalProps.children}
      </Modal>
      {
        //TODO: separate to component
      }
      <Modal
        opened={modalType === ModalType.Changes}
        onClose={closeModal}
        title={modalProps.title ?? t("unsaved_changes_ttl")}
        centered
        padding="lg"
        ta={"center"}
        styles={{
          title: { fontSize: 18, fontWeight: 600 }, // Custom title style
          // inner: { padding: "500px" }, // Adds padding inside the modal box
        }}
      >
        <Text
          size="sm"
          style={{ textAlign: locale === "ar" ? "right" : "left" }}
        >
          {modalProps.message ?? t("unsaved_changes_msg")}
        </Text>
        <Flex direction="row" mt={"lg"} gap={"sm"}>
          <Button
            variant="light"
            color="red"
            onClick={() => {
              closeModal();
              router.back();
            }}
            style={{ flex: 1 }}
          >
            {modalProps.cancel ?? t("discard_changes")}
          </Button>
          <Button onClick={closeModal} variant="default" style={{ flex: 1 }}>
            {modalProps.stay ?? t("stay")}
          </Button>
        </Flex>
      </Modal>
    </ModalContext.Provider>
  );
};

// Custom hook to use modal
export const useModal = () => useContext(ModalContext);
