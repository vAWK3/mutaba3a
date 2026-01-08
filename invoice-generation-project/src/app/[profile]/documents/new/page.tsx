"use client";

import { ResponsiveSizeAppShell } from "@/components/mainContainer/customAppShell";

import {
  Button,
  Title,
  rem,
  Textarea,
  Flex,
  Box,
  LoadingOverlay,
} from "@mantine/core";

import { useState, useEffect, useContext } from "react";
import {
  DocumentItem,
  DocumentData,
  NewDocumentType,
  ClientData,
  BusinessType,
  Currency,
  Language,
  DocumentPayment,
} from "@/types";

import { ModalType, useModal } from "@/contexts/ModalContext";
import { useTranslations } from "next-intl";
import ItemGenerator from "@/app/ui/new_document/items";
import DocumentAmounts from "@/app/ui/new_document/amounts";
import Parties from "@/app/ui/new_document/parties";
import { FormErrors, useForm } from "@mantine/form";
import { toSnakeCase } from "../../../../../utilities/drf";
import { makePostRequest } from "@/app/api/api";
import DocInfo from "@/app/ui/new_document/info";
import DocSettings from "@/app/ui/new_document/settings";
import { ProfileContext } from "@/contexts/ProfileContext";
import { PDFViewer } from "@react-pdf/renderer";
import PreviewDoc from "@/app/ui/new_document/preview_doc";
import { Header } from "@/app/ui/new_document/header";
import NewDocumentSuccess from "@/app/ui/new_document/success";
import PaymentMethods from "@/app/ui/new_document/payments";
import DocumentPageView from "@/app/ui/new_document/pageview";

//TODO: add reference document to design
//TODO: export total calculations and make sure items which are VAT exempt are not included in vat calculations

const CreateDocumentPage = ({
  searchParams,
}: {
  searchParams: {
    type?: string;
    clientId?: string;
    client?: string;
    success: string;
  };
}) => {
  const t = useTranslations("Documents");
  const tf = useTranslations("Form");
  const profiles = useContext(ProfileContext);

  const { openModal } = useModal();

  const type = searchParams.type?.toLowerCase();
  const clientName = searchParams.client;
  const clientId = searchParams.clientId;
  const success = searchParams?.success == "true";

  const dateNextMonth = new Date();
  dateNextMonth.setDate(dateNextMonth.getDate() + 30);

  const [documentType, setDocumentType] = useState<string | undefined>(type);
  const [refDocument, setRefDocument] = useState<DocumentData | undefined>();
  const [documentData, setDocumentData] = useState<DocumentData>({
    settings: { currency: Currency.Shekel, language: Language.en },
    issueDate: new Date(),
    items: [],
    payment: [],
    discount: 0,
    type: NewDocumentType[type as keyof typeof type] ?? NewDocumentType.Invoice,
    subtotal: 0,
    tax: 0,
    total: 0,
    clientId: clientId,
    dueDate: dateNextMonth,
    refDocumentId: refDocument?.id,
  });
  const [oneThirdWidth, setOneThirdWidth] = useState<number>(0);
  const [isLoadingDocument, setLoadingDocument] = useState<boolean>(false);
  const [isCreatingDocument, setCreatingDocument] = useState<boolean>(false);
  const [errorCreatingDocument, setErrorCreatingDocument] = useState();



  // resize doc preview "aside" to one third of screen width on desktop only
  useEffect(() => {
    const updateWidth = () => {
      setOneThirdWidth(window.innerWidth / 2);
    };

    updateWidth(); // Set initially

    window.addEventListener("resize", updateWidth);

    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // document title
  useEffect(() => {
    if (!documentType) {
      return;
    }
    document.title = `${clientName ?? ""} ${t(`${documentType}`)}`;
    document.title = `${t(`${documentType}`)}`;
  }, [documentType, t, clientName]);

  // form validation logic
  const form = useForm({
    mode: "uncontrolled",
    initialValues: documentData,
    validate: {
      subject: (value) => {
        if (!value) {
          return tf("subject_err");
        }

        return null;
      },
      client: (value: ClientData | undefined) => {
        if (!value) {
          return tf("client_err");
        }

        return null;
      },

      settings: {
        currency: (value) => {
          if (!value) {
            return tf("currency_err");
          }
          return null;
        },
        language: (value) => {
          if (!value) {
            return tf("language_err");
          }
          return null;
        },
      },
      items: (value: DocumentItem[]) => {
        if (value.length == 0) {
          return tf("item_zero_err");
        }
        for (const item of value) {
          if (!item.name || item.name.length === 0) {
            return tf("item_name_err");
          }

          if (item.quantity === 0) {
            return tf("item_qty_err");
          }
        }
        return null;
      },
      issueDate: (value: Date) => {
        if (!value) {
          return tf("date_err");
        }

        const today = new Date();

        // Set time of today to midnight (to ignore time part)
        today.setHours(0, 0, 0, 0);

        if (value < today) {
          return tf("date_err");
        }

        return null;
      },

      dueDate: (value, values, path) => {
        if (!value) {
          if (type != "receipt") {
            return tf("date_err");
          }
          return null;
        }

        if (value < values.issueDate) {
          return tf("due_date_early_err");
        }

        return null;
      },

      discount: (value: number) => {
        if (value < 0) {
          return "Discount can't be negative";
        }
      },
    },
  });

  // for logging purposes
  const handleError = (error: FormErrors) => {
    console.log("having errors with ", error);
  };

  // create document
  const handleSubmit = (values: typeof form.values) => {

    const reqData = toSnakeCase(values);

    setCreatingDocument(true);

    makePostRequest("/api/documents/", reqData)
      .then((data) => {
        const res = data;
        if (res) {
          window.location.href = `${profiles?.activeProfile?.id}/documents/new?success=true`;
        }
        setCreatingDocument(false);
      })
      .catch((err) => {
        console.error("Error creating profile", err);
        setCreatingDocument(false);
        setErrorCreatingDocument(err);
      });
  };

  // show modal on mobile
  const handleShowPreview = () => {
    openModal(ModalType.Custom, {
      children: (
        <Flex w={"100%"} h={"90vh"}>
          <PDFViewer width={"100%"} height={"100%"}>
            <PreviewDoc
              document={documentData}
              template={"template1"}
              profile={
                profiles?.activeProfile ?? profiles?.profiles
                  ? profiles?.profiles![0]
                  : undefined
              }
            />
          </PDFViewer>
        </Flex>
      ),
    });
  };

  const handleSaveDraft = () => {
    setCreatingDocument(true);

    const reqData = toSnakeCase(documentData);

    makePostRequest("/api/documents/", reqData)
      .then((data) => {
        const res = data;
        if (res) {
          window.location.href = `${profiles?.activeProfile?.id}/documents/new?success=true&draft=true`;
        }
        setCreatingDocument(false);
      })
      .catch((err) => {
        console.error("Error creating profile", err);
        setCreatingDocument(false);
        setErrorCreatingDocument(err);
      });
  };

  const shouldShowDueDate =
    type != "receipt" &&
    type != "credit_note" &&
    type != "price_offer" &&
    type != "proforma_invoice" &&
    type != "donation_receipt";

  const shouldShowBrief = type != "receipt" && type != "credit_note";

  const shouldShowPayment =
    type == "receipt" ||
    type == "invoice_receipt" ||
    type == "donation_receipt";

  const clientDisabled =
    type == "receipt" || type == "credit_note" || refDocument != undefined;

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    form.setValues(documentData);
    form.onSubmit(handleSubmit, handleError)(event);
  };

  return (
    <form onSubmit={handleFormSubmit}>
      <ResponsiveSizeAppShell
        withNavbar={false}
        withMain={false}
        withBreadcrumb={false}
        asideWidth={{
          base: 0,
          md: success ? 0 : oneThirdWidth,
          lg: success ? 0 : oneThirdWidth,
        }}
        isFullWidth
        headerButtons={
          !success && <Header type={type} onSaveDraft={handleSaveDraft} />
        }
        exitButton={
          !success && (
            <Button
              variant="light"
              color="red"
              fw={400}
              onClick={() => openModal(ModalType.Changes)}
            >
              {t("exit", {
                type: t(`${type}`),
              })}
            </Button>
          )
        }
        aside={
          !success && (
            <Flex w={"100%"} h={"100%"} align={"center"} justify={"center"}>
              {profiles && profiles.profiles && (
                <Box w={"100%"} h={"100%"} p={"xl"}>
                  <DocumentPageView
                    document={documentData}
                    activeProfile={
                      profiles?.activeProfile ?? profiles?.profiles
                        ? profiles?.profiles![0]
                        : undefined
                    }
                  />
                  {/* <PDFViewer width={"100%"} height={"100%"}>
                    <PreviewDoc
                    template={"template1"}
                    document={documentData}
                      profile={
                        profiles?.activeProfile ?? profiles?.profiles
                          ? profiles?.profiles![0]
                          : undefined
                      }
                    />
                  </PDFViewer> */}
                </Box>
              )}
            </Flex>
          )
        }
      >
        {!success && (
          <Box pos="relative">
            <LoadingOverlay
              visible={isCreatingDocument}
              zIndex={1000}
              overlayProps={{ radius: "sm", blur: 2 }}
            />
            <div>
              <Title order={1} fz={rem(36)} fw={500}>
                {t("new", {
                  type: t(`${type}`),
                })}
              </Title>

              <Parties
                mt={"md"}
                clientDisabled={clientDisabled}
                onClientSelect={(client) => {
                  form.setFieldValue("client", client);
                  setDocumentData((prev) => {
                    return { ...prev, client };
                  });
                }}
                //TODO: impelement initial client from args or somewhere
                initialClient={{
                  id: clientId,
                  name: clientName ?? "Basel Sader",
                  email: "basel@gmail.com",
                  businessProfile: 1,
                  address: {
                    address1En: "19 Hizma Road",
                    cityEn: "Jerusalem",
                  },
                }}
                form={form}
              />

              <DocInfo
                form={form}
                document={documentData}
                onUpdateDocument={setDocumentData}
                type={t(`${type ?? ""}`)}
                withBrief={shouldShowBrief}
                withDueDate={shouldShowDueDate}
              />

              <ItemGenerator
                mt={"md"}
                form={form}
                document={documentData}
                taxPercent={0.17}
                onItemsChange={(items: DocumentItem[]) => {
                  setDocumentData((prev) => {
                    return { ...prev, items };
                  });
                }}
                onTotalChange={(subtotal: number) => {
                  setDocumentData((prev) => {
                    const tax =
                      (subtotal - prev.discount) *
                      (profiles?.activeProfile?.businessType ==
                        BusinessType.EXEMPT
                        ? 0
                        : 0.17);

                    const total = subtotal - prev.discount + tax;

                    return {
                      ...prev,
                      subtotal,
                      tax: tax,
                      total: total,
                    };
                  });
                }}
              />

              {shouldShowPayment && (
                <PaymentMethods
                  mt={"md"}
                  onTotalChange={(total: number) => {
                    console.log("total is ", total);
                  }}
                  onItemsChange={(payment: DocumentPayment[]) => {
                    setDocumentData((prev) => {
                      return { ...prev, payment };
                    });
                  }}
                  document={documentData}
                  form={form}
                />
              )}

              <DocSettings
                document={documentData}
                onUpdateDocument={setDocumentData}
                mt="md"
              />

              <DocumentAmounts
                document={documentData}
                taxPercent={
                  profiles?.activeProfile?.businessType == BusinessType.EXEMPT
                    ? 0
                    : 0.17
                }
                exchangeRate={1}
                mt="md"
              />

              <Textarea
                label={t("notes_lbl")}
                placeholder={t("notes_ph")}
                value={documentData.notes}
                onChange={(e) =>
                  setDocumentData((prev) => {
                    return { ...prev, notes: e.currentTarget?.value };
                  })
                }
                mt={"md"}
              />
            </div>
          </Box>
        )}

        {success && (
          <NewDocumentSuccess number={"90001"} type={documentData.type} />
        )}

        <Button hiddenFrom="md" variant="default" onClick={handleShowPreview}>
          {t("preview")}
        </Button>
      </ResponsiveSizeAppShell>
    </form>
  );
};

export default CreateDocumentPage;
