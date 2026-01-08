import React from "react";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { formatDate, formatTotal } from "../../../../utilities/formatters";
import { getNameWithLanguage } from "../../../../utilities/names";
import { DocumentData, Language, ProfileData } from "@/types";

//TODO: handle rtl + templates
//TODO: add images

Font.register({
  family: "IBMPlexSansArabic",
  fonts: [
    {
      src: "../../fonts/IBMPlexSansArabic-Bold.ttf",
      fontWeight: 700,
    },
    {
      src: "../../fonts/IBMPlexSansArabic-SemiBold.ttf",
      fontWeight: 600,
    },
    {
      src: "../..//fonts/IBMPlexSansArabic-Medium.ttf",
      fontWeight: 500,
    },
    {
      src: "../../fonts/IBMPlexSansArabic-Regular.ttf",
      fontWeight: 400,
    },
  ],
});

Font.register({
  family: "IBMPlexSansHebrew",
  fonts: [
    {
      src: "../../fonts/IBMPlexSansHebrew-Bold.ttf",
      fontWeight: 700,
    },
    {
      src: "../../fonts/IBMPlexSansHebrew-SemiBold.ttf",
      fontWeight: 600,
    },
    {
      src: "../..//fonts/IBMPlexSansHebrew-Medium.ttf",
      fontWeight: 500,
    },
    {
      src: "../../fonts/IBMPlexSansHebrew-Regular.ttf",
      fontWeight: 400,
    },
  ],
});

Font.register({
  family: "IBMPlexSans",
  fonts: [
    {
      src: "../../fonts/IBMPlexSans-Bold.ttf",
      fontWeight: 700,
    },
    {
      src: "../../fonts/IBMPlexSans-SemiBold.ttf",
      fontWeight: 600,
    },
    {
      src: "../..//fonts/IBMPlexSans-Medium.ttf",
      fontWeight: 500,
    },
    {
      src: "../../fonts/IBMPlexSans-Regular.ttf",
      fontWeight: 400,
    },
  ],
});

const styles1 = StyleSheet.create({
  page: {
    padding: "20mm",
    fontSize: 12,
    lineHeight: 1.5,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    fontFamily: "IBMPlexSansArabic",
  },
  header: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginBottom: 12,
    fontWeight: 700,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1px solid black",
    paddingBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
  },
  quantityRow: {
    textAlign: "right",
  },
  tableCell: {
    padding: 4,
    textAlign: "right",
  },
  notes: {
    fontSize: 12,
    marginTop: 20,
  },
  text: {
    fontFamily: "IBMPlexSansArabic",
    fontWeight: "normal",
    fontSize: 14,
  },
  client: {
    marginTop: 20,
  },
});

const styles2 = StyleSheet.create({
  page: {
    padding: "20mm",
    fontSize: 12,
    lineHeight: 1.5,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    fontFamily: "IBMPlexSansArabic",
    backgroundColor: "#08afff",
  },
  header: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginBottom: 12,
    fontWeight: 700,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1px solid black",
    paddingBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
  },
  quantityRow: {
    textAlign: "right",
  },
  tableCell: {
    padding: 4,
    textAlign: "right",
  },
  notes: {
    fontSize: 12,
    marginTop: 20,
  },
  text: {
    fontFamily: "IBMPlexSansArabic",
    fontWeight: "normal",
    fontSize: 14,
  },
  client: {
    marginTop: 20,
  },
});

const styles3 = StyleSheet.create({
  page: {
    padding: "20mm",
    fontSize: 18,
    lineHeight: 1.5,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    fontFamily: "IBMPlexSansArabic",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginBottom: 12,
    fontWeight: 700,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1px solid black",
    paddingBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
  },
  quantityRow: {
    textAlign: "right",
  },
  tableCell: {
    padding: 4,
    textAlign: "right",
  },
  notes: {
    fontSize: 14,
    marginTop: 20,
  },
  text: {
    fontFamily: "IBMPlexSansArabic",
    fontWeight: "normal",
    fontSize: 16,
  },
  client: {
    marginTop: 20,
  },
});

interface PreviewPDFProps {
  template: string;
  original?: boolean;
  document: DocumentData;
  profile: ProfileData | undefined;
}

const texts = {
  ar: {
    item: "بند",
    subject: "موضوع",
    quantity: "كمية",
    rate: "سعر",
    price: "مجموع",
    subtotal: "المجموع الفرعي",
    tax: "ضريبة",
    discount: "خصم",
    total: "مجموع",
    notes: "ملاحظات",
    issued: "أٌصدر",
    due: "مستحق",
    invoice: "فاتورة",
    price_offer: "عرض سعر",
    receipt: "سند قبض",
    invoice_receipt: "فاتورة",
    credit_note: "إشعار دائن",
    proforma_invoice: "فاتورة أولية",
    donation_receipt: "سند تبرّع",
    original: "الأصل",
    copy: "نسخة طبق الأصل",
  },
  en: {
    item: "Item",
    subject: "Subject",
    quantity: "Qty",
    rate: "Rate",
    price: "Price",
    subtotal: "Subtotal",
    tax: "Tax",
    discount: "Discount",
    total: "Total",
    notes: "Notes",
    issued: "Issued",
    due: "Due",
    invoice: "Invoice",
    price_offer: "Price Offer",
    receipt: "Receipt",
    invoice_receipt: "Invoice Receipt",
    credit_note: "Credit Note",
    proforma_invoice: "Proforma Invoice",
    donation_receipt: "Donation Receipt",
    original: "Original",
    copy: "Certified Copy",
  },
  he: {
    item: "פריט",
    subject: "נושא",
    quantity: "כמות",
    rate: "מחיר",
    price: "סה״כ",
    subtotal: "סיכום ביניים",
    tax: "מס",
    discount: "הנחה",
    total: "סך הכל",
    notes: "הערות",
    issued: "תאריך הוצאה",
    due: "תאריך יעד",
    invoice: "חשבונית",
    price_offer: "הצעת מחיר",
    receipt: "קבלה",
    invoice_receipt: "חשבונית קבלה",
    credit_note: "הודעת זיכוי",
    proforma_invoice: "חשבונית פרופורמה",
    donation_receipt: "קבלת תרומה",
    original: "מקור",
    copy: "העתק",
  },
};

const PreviewDoc = ({
  document,
  template,
  profile,
  original = false,
}: PreviewPDFProps) => {
  const {
    settings,
    client,
    items,
    issueDate,
    dueDate,
    subtotal,
    tax,
    discount,
    total,
    type,
    notes,
    subject,
    brief,
  } = document;

  const language =
    settings.language == Language.ar
      ? "ar"
      : settings.language == Language.he
      ? "he"
      : ("en" as keyof typeof texts);
  const currency = settings.currency;

  const styles =
    template == "template1"
      ? styles1
      : template == "template2"
      ? styles2
      : styles3;

  if (language == "ar") {
    styles.page.fontFamily = "IBMPlexSansArabic";
    styles.text.fontFamily = "IBMPlexSansArabic";
  } else if (language == "en") {
    styles.page.fontFamily = "IBMPlexSans";
    styles.text.fontFamily = "IBMPlexSans";
  } else if (language == "he") {
    styles.page.fontFamily = "IBMPlexSansHebrew";
    styles.text.fontFamily = "IBMPlexSansHebrew";
  }

  return (
    <Document>
      <Page style={styles.page} size={"A4"}>
        {/* Header */}
        <View>
          <View style={styles.header}>
            {profile && (
              <View>
                <Text>
                  {getNameWithLanguage({
                    language: language,
                    en: profile.nameEn,
                    ar: profile.nameAr,
                    he: profile.nameHe,
                  })}
                </Text>
                <Text style={styles.text}>
                  {getNameWithLanguage({
                    language: language,
                    ar: profile.address.address1Ar,
                    en: profile.address.address1En,
                    he: profile.address.address1He,
                  })}
                </Text>
                <Text style={styles.text}>{profile.email}</Text>
              </View>
            )}
            <View>
              <Text style={styles.text}>{texts[language][type]} # ----</Text>
              <Text style={styles.text}>
                {texts[language]["issued"]} {formatDate(issueDate)}
              </Text>
              {dueDate && (
                <Text style={styles.text}>
                  {texts[language]["due"]} {formatDate(dueDate)}
                </Text>
              )}
            </View>
          </View>

          {/* Subject */}
          <View>
            <Text style={styles.text}>{subject}</Text>
            <Text style={styles.text}>{brief}</Text>
          </View>

          {/* Client Information */}
          {client && (
            <View style={styles.client}>
              <Text style={styles.text}>{client.name}</Text>
              <Text style={styles.text}>
                {getNameWithLanguage({
                  language: language,
                  ar: client.address?.address1Ar,
                  en: client.address?.address1En,
                  he: client.address?.address1He,
                })}
              </Text>
            </View>
          )}
        </View>

        <View>
          <Text style={{ width: "100%", textAlign: "center", fontWeight: 700 }}>
            {texts[language][original ? "original" : "copy"].toUpperCase()}
          </Text>
        </View>

        <View>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={{ width: "50%" }}>{texts[language]["item"]}</Text>
            <Text style={{ width: "15%", textAlign: "right" }}>
              {texts[language]["quantity"]}
            </Text>
            <Text style={{ width: "15%", textAlign: "right" }}>
              {texts[language]["rate"]}
            </Text>
            <Text style={{ width: "20%", textAlign: "right" }}>
              {texts[language]["price"]}
            </Text>
          </View>

          {/* Table Rows */}
          {items.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={{ width: "50%" }}>{item.name}</Text>
              <Text style={{ width: "15%", textAlign: "right" }}>
                {formatTotal(item.quantity)}
              </Text>
              <Text style={{ width: "15%", textAlign: "right" }}>
                {formatTotal(item.rate)}
              </Text>
              <Text style={{ width: "20%", textAlign: "right" }}>
                {formatTotal(item.quantity * item.rate, currency)}
              </Text>
            </View>
          ))}

          {/* Summary */}
          <View style={{ textAlign: "right", marginTop: 60 }}>
            <Text>
              {texts[language]["subtotal"]} {formatTotal(subtotal, currency)}
            </Text>
            {discount > 0 && (
              <Text>
                {texts[language]["discount"]} {formatTotal(discount, currency)}
              </Text>
            )}
            <Text>
              {texts[language]["tax"]} {formatTotal(tax, currency)}
            </Text>
            <Text>
              {texts[language]["total"]} {formatTotal(total, currency)}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {notes && (
          <Text style={styles.notes}>
            {texts[language]["notes"]} {notes}
          </Text>
        )}

        <View>
          <Text>Digitally certified</Text>
        </View>
      </Page>
    </Document>
  );
};

export default PreviewDoc;
