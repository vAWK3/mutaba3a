import React from "react";
import type { Metadata } from "next";
import {
  ColorSchemeScript,
  DirectionProvider,
  MantineProvider,
} from "@mantine/core";
import "@mantine/dates/styles.css";
import "@mantine/spotlight/styles.css";
import "../../styles/globals.css";
import { UserProvider } from "@auth0/nextjs-auth0/client";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Notifications } from "@mantine/notifications";
import "../../styles/globals.css";
import "@mantine/core/styles.layer.css";
import "mantine-datatable/styles.layer.css";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/charts/styles.css";

import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { fontAr, fontEn } from "./ui/fonts";
import { themeArabic, themeEnglish } from "../../styles/theme";
// import Head from "next/head";
import { ModalProvider } from "@/contexts/ModalContext";
import { ClientSpotlightProvider } from "@/contexts/SpotlightContext";
import Clients from "./[profile]/clients/page";
import ProfileProvider from "@/contexts/ProfileContext";

// export const experimental_ppr = true;

export const metadata: Metadata = {
  title: "Fatura",
  description: "Professional invoice generator",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} dir={locale == "en" ? "ltr" : "rtl"}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/favicon/apple-touch-icon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon/favicon-16x16.png"
        />
        <link rel="manifest" href="/favicon/site.webmanifest" />
        {/* <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5" /> */}
        <meta name="msapplication-TileColor" content="#2463EB" />
        <meta name="theme-color" content="#2463EB" />
      </head>

      <body
        className={`${
          locale == "ar" ? fontAr.className : fontEn.className
        } antialiased max-w-[3024px] mx-auto px-4`}
      >
        <DirectionProvider>
          <UserProvider>
            <MantineProvider
              theme={locale == "ar" ? themeArabic : themeEnglish}
              defaultColorScheme="auto"
            >
              <ThemeProvider>
                <NextIntlClientProvider messages={messages} locale={locale}>
                  <ProfileProvider>
                    <Notifications />
                    <ClientSpotlightProvider>
                      <ModalProvider>{children}</ModalProvider>
                    </ClientSpotlightProvider>
                  </ProfileProvider>
                </NextIntlClientProvider>
              </ThemeProvider>
            </MantineProvider>
          </UserProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
