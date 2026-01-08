"use client";

import { Flex, Title, Button, rem, Text } from "@mantine/core";
import { ResponsiveSizeAppShell } from "@/components/mainContainer/customAppShell";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { ModalType, useModal } from "@/contexts/ModalContext";
import { useTranslations } from "next-intl";
import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import ClientCreateSuccess from "@/app/ui/clients/success";
import { ClientData, Currency, Language, PaymentTerms } from "@/types";
import { toSnakeCase } from "../../../../../utilities/drf";
import { notifications } from "@mantine/notifications";
import { FormErrors, hasLength, isEmail, useForm } from "@mantine/form";
import ClientDocumentForm from "@/app/ui/clients/new/document";
import ClientForm, { mutedColors } from "@/app/ui/clients/new/client";
import { makePostRequest } from "@/app/api/api";
import { useContext } from "react";
import { ProfileContext } from "@/contexts/ProfileContext";

const Page = ({
  searchParams,
}: {
  searchParams?: {
    success?: any;
  };
}) => {
  const { openModal } = useModal();

  const profiles = useContext(ProfileContext);

  const t = useTranslations("Clients");
  const tb = useTranslations("Buttons");

  const tf = useTranslations("Form");

  const success = searchParams?.success || null;

  const handleFailure = (errors: FormErrors) => {
    console.log("error in form ", errors);
  };

  const handleSubmit = (values: typeof form.values) => {
    const reqData = toSnakeCase(values);
    const { document, ...reqDataWithoutDocument } = reqData;

    reqDataWithoutDocument['external_identifier'] = '1234';

    // const data = JSON.stringify(reqDataWithoutDocument);

    /**
     *     "name": "test client",
    "tax_id": "1234",
    "external_identifier": "123",
    "address": {
        "address1_en": "123 Main Street",
        "address1_ar": "١٢٣ الشارع الرئيسي",
        "address1_he": "123 רחוב ראשי",
        "address2_en": "Suite 100",
        "address2_ar": "جناح ١٠٠",
        "address2_he": "סוויטה 100",
        "postal_code": "10001",
        "city_en": "New York",
        "city_ar": "نيويورك",
        "city_he": "ניו יורק",
        "country_en": "USA",
        "country_ar": "الولايات المتحدة الأمريكية",
        "country_he": "ארצות הברית"
    },
    "phone_number": "123",
    "email": "test@example.com",
    "payment_terms": "immediate",
    "business_profile": 1
     */


    console.log('submitting data with ', reqDataWithoutDocument);



    makePostRequest(`/api/clients/${profiles?.activeProfile?.id ?? 2}`, reqDataWithoutDocument)
      .then((data) => {
        console.log('posting donee');
        const res = data;
        if (res.success) {
          window.location.href = `${profiles?.activeProfile?.id}/clients/new?success=true`;
        } else {
          notifications.show({
            message: <Text>{res.error ?? tf("error")}</Text>,
            color: "red",
          });
        }
      })
      .catch((err) => {
        console.error("Error creating client", err);
        notifications.show({
          // message: <Text>{err ?? tf("error")}</Text>,
          message: tf("error"),
          color: "red",
        });
      });
  };

  //TODO: update defaults to be from profile settings
  const initialClientData: ClientData = {
    businessProfile: 1, // Retrieve this from param
    name: "",
    email: "",
    address: {
      address1En: "",
    },
    document: {
      currency: Currency.Shekel,
      language: Language.en,
      discount: 0,
      payment: PaymentTerms.IMMEDIATE,
    },
  };

  const form = useForm({
    mode: "uncontrolled",
    initialValues: initialClientData,
    validate: {
      name: hasLength({ min: 3 }, tf("name_err")),
      email: isEmail(tf("email_err")),
      address: {
        address1En: (value: string | undefined) => {
          if ((value?.length ?? 0) <= 3) {
            return tf("address_err");
          }
          return null;
        },
        cityEn: (value: string | undefined) => {
          if ((value?.length ?? 0) <= 3) {
            return tf("city_err");
          }
          return null;
        },
      },
      taxId: (taxValue: string | null | undefined) => {
        const value = taxValue?.toString();

        if (!value || value.length == 0) {
          return null;
        }

        if ((value?.length ?? 0) != 9) {
          return tf("taxid_err");
        }

        return null;
      },
      document: {
        language: (value: string | undefined) => {
          if (value === undefined) {
            return tf("language_err");
          }

          return null;
        },
        currency: (value: string | undefined) => {
          if (value === undefined) {
            return tf("currency_err");
          }

          return null;
        },
      },
    },
  });

  return (
    <ResponsiveSizeAppShell
      headerButtons={[
        <Button
          variant="default"
          key="cancel"
          onClick={() => openModal(ModalType.Changes)}
        >
          {tb("cancel")}
        </Button>,
      ]}
    >
      {success && <ClientCreateSuccess name={"Ahmad Salhab"} />}
      {!success && (
        <ResponsiveGrid desktopSpan={[3, 6, 3]} mobileSpan={[12, 12, 12]}>
          <></>
          <Flex direction={"column"}>
            <Title order={1} fz={rem(36)} fw={500} ta={"start"}>
              {t("new_client")}
            </Title>

            <form onSubmit={form.onSubmit(handleSubmit, handleFailure)}>
              <ClientForm form={form} />

              <ClientDocumentForm form={form} />

              <Flex justify={"flex-end"} align={"end"} mt={"xl"}>
                <Button
                  key="create"
                  type="submit"
                >
                  {tb("create_client")}
                  <IconArrowLeft size={"18px"} className="ltr:hidden" />
                  <IconArrowRight size={"18px"} className="rtl:hidden" />
                </Button>
              </Flex>
            </form>
          </Flex>
          <></>
        </ResponsiveGrid>
      )}
    </ResponsiveSizeAppShell>
  );
};

export default Page;
