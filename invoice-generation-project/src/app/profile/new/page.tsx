"use client";

//TODO: create common layout with welcome page and create business page
import {
  Flex,
  AppShell,
  AppShellMain,
  AppShellFooter,
  AppShellHeader,
  Box,
} from "@mantine/core";

import { ResponsiveGrid } from "@/components/grid/responsive_grid";
import Footer from "@/components/footer/footer";
import BusinessForm from "@/app/ui/profile/businessForm";
import LocaleSwitcher from "@/components/language/language_switcher";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useUser } from "@auth0/nextjs-auth0/client";
import BackButton from "@/components/buttons/back_button";
import ProfileCreateSuccess from "@/app/ui/profile/success";
import { useRouter } from "next/navigation";
import { ProfileData, BusinessType, MultilingualFormData } from "@/types";

import { toSnakeCase } from "../../../../utilities/drf";
import { isEmail, useForm } from "@mantine/form";
import { makePostRequest } from "@/app/api/api";
import InvoiceForm from "@/app/ui/profile/invoiceForm";

const Page = ({
  searchParams,
}: {
  searchParams?: {
    success?: any;
  };
}) => {
  const success = searchParams?.success || null;
  const t = useTranslations("Profile");
  const tf = useTranslations("Form");
  const router = useRouter();
  const user = useUser();
  const [currentPage, setCurrentPage] = useState({
    current: "business",
    previous: null,
  });

  const initialProfileData: ProfileData = {
    address: {},
    businessType: null,
    email: "",
  };

  const pageNav: Record<string, any> = {
    business: {
      current: "business",
      previous: null,
    },
    invoice: {
      current: "invoice",
      previous: "business",
    },
  };

  const handleNextPage = (page: string) => {
    setCurrentPage(pageNav[page as keyof typeof pageNav]);
  };

  const invoiceForm = useForm<MultilingualFormData<ProfileData>>({
    mode: "uncontrolled",
    initialValues: { en: true, ar: false, he: false, data: initialProfileData },
    validate: {
      data: {
        businessCertificate: (value: File | string | null | undefined) => {
          if (invoiceForm.getValues().data.businessType != BusinessType.NONE) {
            if (value == null || value == undefined) {
              return tf("certificate_err");
            }
          }

          return null;
        },
        taxId: (taxValue: string | null | undefined) => {
          const value = taxValue?.toString();

          if (invoiceForm.getValues().data.businessType != BusinessType.NONE) {
            if (!value || value.length != 9) {
              return tf("taxid_err");
            }
          }

          if (!value || value.length == 0) {
            return null;
          }

          if ((value?.length ?? 0) != 9) {
            return tf("taxid_err");
          }

          return null;
        },
        email: isEmail(tf("email_err")),
        nameEn: (value: string | undefined) => {
          if (!currentPage.previous) {
            return null;
          }
          const values = invoiceForm.getValues();

          if (!values.en) {
            return null;
          }

          if (!value || value.length <= 3) {
            return tf("name_err");
          }
          return null;
        },
        nameAr: (value: string | undefined) => {
          if (!currentPage.previous) {
            return null;
          }
          const values = invoiceForm.getValues();

          if (!values.ar) {
            return null;
          }

          if ((value?.length ?? 0) <= 3) {
            return tf("name_err");
          }
          return null;
        },
        nameHe: (value: string | undefined) => {
          if (!currentPage.previous) {
            return null;
          }
          const values = invoiceForm.getValues();

          if (!values.he) {
            return null;
          }

          if ((value?.length ?? 0) <= 3) {
            return tf("name_err");
          }
          return null;
        },
        address: {
          address1En: (value: string | undefined) => {
            if (!currentPage.previous) {
              return null;
            }
            const values = invoiceForm.getValues();

            if (!values.en) {
              return null;
            }

            if ((value?.length ?? 0) <= 3) {
              return tf("address_err");
            }
            return null;
          },
          address1Ar: (value: string | undefined) => {
            if (!currentPage.previous) {
              return null;
            }
            const values = invoiceForm.getValues();

            if (!values.ar) {
              return null;
            }

            if ((value?.length ?? 0) <= 3) {
              return tf("address_err");
            }
            return null;
          },
          address1He: (value: string | undefined) => {
            if (!currentPage.previous) {
              return null;
            }
            const values = invoiceForm.getValues();

            if (!values.he) {
              return null;
            }

            if ((value?.length ?? 0) <= 3) {
              return tf("address_err");
            }
            return null;
          },
          cityEn: (value: string | undefined) => {
            if (!currentPage.previous) {
              return null;
            }
            const values = invoiceForm.getValues();

            if (!values.en) {
              return null;
            }

            if ((value?.length ?? 0) <= 3) {
              return tf("city_err");
            }
            return null;
          },
          cityAr: (value: string | undefined) => {
            if (!currentPage.previous) {
              return null;
            }
            const values = invoiceForm.getValues();

            if (!values.ar) {
              return null;
            }

            if ((value?.length ?? 0) <= 3) {
              return tf("city_err");
            }
            return null;
          },
          cityHe: (value: string | undefined) => {
            if (!currentPage.previous) {
              return null;
            }
            const values = invoiceForm.getValues();

            if (!values.he) {
              return null;
            }

            if ((value?.length ?? 0) <= 3) {
              return tf("city_err");
            }
            return null;
          },
        },
      },
    },
  });

  const handleInvoiceSubmit = (values: typeof invoiceForm.values) => {
    if (!user) {
      //TODO: display error message or redirect to login page or display loading
      return;
    }

    //TODO: display loading data

    const reqData = toSnakeCase(values.data);

    reqData["user_id"] = user.user?.sub;
    //TODO: handle
    reqData["license_url"] = "test";
    reqData["logo_url"] = "test";
    reqData["business_certificate"] = "test";
    reqData["phone_number"] = "05457979595";

    // const data = JSON.stringify(reqData);

    console.log('making post request with data ', reqData);

    makePostRequest("/api/profile", reqData)
      .then((data) => {
        const res = data;
        if (res) {
          router.push("/profile/new?success=true");
        }
      })
      .catch((err) => {
        console.error("Error creating profile", err);
      });
  };

  const handleBusinessSubmit = (values: typeof invoiceForm.values) => {
    handleNextPage("invoice");
  };

  const pages = {
    business: (
      <Box w={"100%"}>
        <form onSubmit={invoiceForm.onSubmit(handleBusinessSubmit)}>
          <BusinessForm
            title={[t("create_profile_1"), t("create_profile_2")]}
            form={invoiceForm}
          />
        </form>
      </Box>
    ),
    invoice: (
      <Box w={"100%"}>
        <form onSubmit={invoiceForm.onSubmit(handleInvoiceSubmit)}>
          <InvoiceForm
            title={[t("create_invoice_1"), t("create_invoice_2")]}
            form={invoiceForm}
          />
        </form>
      </Box>
    ),
  };

  return (
    <AppShell
      withBorder={false}
      header={{ height: { base: 60, md: 70, lg: 80 }, offset: true }}
      footer={{ height: { base: 60, md: 70, lg: 80 }, offset: true }}
    >
      <AppShellHeader >
        <Flex
          direction={"row"}
          justify={"space-between"}
          align={"center"}
          p={"md"}
        >
          {currentPage.previous && (
            <Flex justify={"flex-start"}>
              <BackButton
                onClick={() => handleNextPage(currentPage.previous!)}
              />
            </Flex>
          )}

          <Flex w={"100%"} justify={"flex-end"}>
            <LocaleSwitcher iconOnly />
          </Flex>
        </Flex>
      </AppShellHeader>
      <AppShellMain>
        {
          //TODO: update profile id
        }
        {success && (
          <ProfileCreateSuccess email={invoiceForm.getValues().data.email} profileId={'2'} />
        )}

        {!success && (
          <ResponsiveGrid
            desktopSpan={
              currentPage.current == "business" ? [4, 4, 4] : [3, 6, 3]
            }
            mobileSpan={[12]}
          >
            <></>
            <Flex
              w={"100%"}
              mt={"10vh"}
              align={"center"}
              justify={"center"}
              direction={"column"}
            >
              {pages[currentPage.current as keyof typeof pages]}
            </Flex>
            <></>
          </ResponsiveGrid>
        )}
      </AppShellMain>
      <AppShellFooter>
        <Footer />
      </AppShellFooter>
    </AppShell>
  );
};

export default Page;
