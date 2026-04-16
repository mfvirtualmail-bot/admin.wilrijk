import React from "react";
import path from "path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Image,
  pdf,
} from "@react-pdf/renderer";
import type { StatementData } from "./statement-data";
import type { EmailSettings, Currency } from "./types";

// Register a combined Latin+Hebrew font so statements render correctly
// regardless of locale AND so Hebrew in otherwise-English output (e.g. a
// Hebrew organisation name, Hebrew child names) doesn't turn into mojibake.
// @fontsource/noto-sans-hebrew ships subsets — register all relevant ones
// under one family; react-pdf picks the right glyph per codepoint.
let notoFontRegistered = false;
function ensureNotoFont() {
  if (notoFontRegistered) return;
  try {
    const base = path.join(process.cwd(), "node_modules", "@fontsource", "noto-sans-hebrew", "files");
    // Subsets at weight 400 + 700 (bold). Three scripts covered: Latin, Latin-ext, Hebrew.
    const srcs400 = [
      "noto-sans-hebrew-latin-400-normal.woff",
      "noto-sans-hebrew-latin-ext-400-normal.woff",
      "noto-sans-hebrew-hebrew-400-normal.woff",
    ];
    const srcs700 = [
      "noto-sans-hebrew-latin-700-normal.woff",
      "noto-sans-hebrew-latin-ext-700-normal.woff",
      "noto-sans-hebrew-hebrew-700-normal.woff",
    ];
    Font.register({
      family: "NotoHebrew",
      fonts: [
        ...srcs400.map((f) => ({ src: path.join(base, f), fontWeight: 400 as const })),
        ...srcs700.map((f) => ({ src: path.join(base, f), fontWeight: 700 as const })),
      ],
    });
    notoFontRegistered = true;
  } catch {
    // Font file missing — fall back to default Helvetica. Hebrew glyphs
    // will render as boxes, which is a clearer failure than crashing.
  }
}

const SYM: Record<Currency, string> = { EUR: "€", USD: "$", GBP: "£" };

function fmt(n: number, currency: Currency = "EUR"): string {
  const sym = SYM[currency] ?? "€";
  return sym + n.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  data: StatementData;
  settings: Pick<EmailSettings, "org_name" | "org_address" | "org_logo_url" | "payment_instructions">;
  locale: "en" | "yi";
}

const L = {
  en: {
    title: "Tuition Statement",
    date: "Statement date",
    family: "Family",
    contact: "Contact",
    email: "Email",
    phone: "Phone",
    ledger: "Ledger",
    dateCol: "Date",
    descriptionCol: "Description",
    chargeCol: "Charge",
    paymentCol: "Payment",
    balanceCol: "Balance",
    totalCharged: "Total charged",
    totalPaid: "Total paid",
    balanceDue: "Balance due",
    paymentInstructions: "How to pay",
    footer: "Thank you.",
    empty: "No charges or payments to display.",
  },
  yi: {
    title: "חשבון פֿאַר שכר לימוד",
    date: "דאַטום פֿון חשבון",
    family: "משפחה",
    contact: "קאָנטאַקט",
    email: "בליץ־פּאָסט",
    phone: "טעלעפֿאָן",
    ledger: "רעקאָרד",
    dateCol: "דאַטום",
    descriptionCol: "באַשרײַבונג",
    chargeCol: "חיוב",
    paymentCol: "באַצאָל",
    balanceCol: "באַלאַנס",
    totalCharged: "סך הכל חיוב",
    totalPaid: "סך הכל באַצאָלט",
    balanceDue: "חוב",
    paymentInstructions: "ווי אַזוי צו באצאָלן",
    footer: "אַ דאַנק.",
    empty: "קיין חיובֿ אָדער באַצאָל אויף צו ווײַזן.",
  },
};

export function StatementDocument({ data, settings, locale }: Props) {
  // Register the Latin+Hebrew font for every render — an English PDF may
  // still contain Hebrew glyphs (org name, child names), and Helvetica
  // (react-pdf's default) has no Hebrew coverage.
  ensureNotoFont();

  const rtl = locale === "yi";
  const lang = L[locale];
  const fontFamily = "NotoHebrew";

  const styles = StyleSheet.create({
    page: {
      padding: 36,
      fontSize: 10,
      fontFamily,
      color: "#111",
      direction: rtl ? "rtl" : "ltr",
    },
    header: {
      flexDirection: rtl ? "row-reverse" : "row",
      alignItems: "center",
      marginBottom: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: "#111",
    },
    logo: { width: 56, height: 56, marginRight: rtl ? 0 : 14, marginLeft: rtl ? 14 : 0 },
    headerText: { flex: 1, textAlign: rtl ? "right" : "left" },
    orgName: { fontSize: 16, fontWeight: 700 },
    orgAddress: { fontSize: 9, color: "#555", marginTop: 2 },
    title: { fontSize: 18, fontWeight: 700, marginTop: 4, marginBottom: 16, textAlign: rtl ? "right" : "left" },
    metaRow: { flexDirection: rtl ? "row-reverse" : "row", marginBottom: 4 },
    metaLabel: { width: 110, color: "#666", fontSize: 9, textAlign: rtl ? "right" : "left" },
    metaValue: { flex: 1, fontSize: 10, textAlign: rtl ? "right" : "left" },
    sectionTitle: { fontSize: 12, fontWeight: 700, marginTop: 18, marginBottom: 8, textAlign: rtl ? "right" : "left" },
    table: { borderWidth: 1, borderColor: "#ccc" },
    row: { flexDirection: rtl ? "row-reverse" : "row", borderBottomWidth: 1, borderBottomColor: "#eee" },
    rowHeader: { backgroundColor: "#f3f4f6" },
    cell: { padding: 5, fontSize: 9 },
    cellDate: { width: 60, textAlign: rtl ? "right" : "left" },
    cellDesc: { flex: 1, textAlign: rtl ? "right" : "left" },
    cellAmount: { width: 70, textAlign: rtl ? "left" : "right" },
    totalsBox: { marginTop: 14, padding: 10, backgroundColor: "#f9fafb", borderWidth: 1, borderColor: "#e5e7eb" },
    totalsRow: { flexDirection: rtl ? "row-reverse" : "row", justifyContent: "space-between", marginBottom: 3 },
    totalsLabel: { fontSize: 10, color: "#444", textAlign: rtl ? "right" : "left" },
    totalsValue: { fontSize: 10, fontWeight: 400, textAlign: rtl ? "left" : "right" },
    balanceDueRow: { marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#d1d5db" },
    balanceDueLabel: { fontSize: 12, fontWeight: 700, textAlign: rtl ? "right" : "left" },
    balanceDueValue: { fontSize: 12, fontWeight: 700, textAlign: rtl ? "left" : "right" },
    instructions: { marginTop: 18, padding: 10, borderWidth: 1, borderColor: "#dbeafe", backgroundColor: "#eff6ff" },
    instructionsTitle: { fontSize: 10, fontWeight: 700, marginBottom: 4, textAlign: rtl ? "right" : "left" },
    instructionsBody: { fontSize: 9, color: "#1e3a8a", textAlign: rtl ? "right" : "left" },
    footer: { marginTop: 24, fontSize: 9, color: "#666", textAlign: rtl ? "right" : "left" },
  });

  const familyName = data.family.hebrew_name && locale === "yi"
    ? data.family.hebrew_name
    : data.family.name;
  const contactParts = [data.family.father_name, data.family.mother_name].filter(Boolean);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          {settings.org_logo_url ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf's Image component does not accept alt
            <Image src={settings.org_logo_url} style={styles.logo} />
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.orgName}>{settings.org_name}</Text>
            {settings.org_address ? (
              <Text style={styles.orgAddress}>{settings.org_address}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.title}>{lang.title}</Text>

        {/* Meta block */}
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{lang.date}:</Text>
          <Text style={styles.metaValue}>{data.statementDate}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{lang.family}:</Text>
          <Text style={styles.metaValue}>{familyName}</Text>
        </View>
        {contactParts.length > 0 ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{lang.contact}:</Text>
            <Text style={styles.metaValue}>{contactParts.join(" / ")}</Text>
          </View>
        ) : null}
        {data.family.email ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{lang.email}:</Text>
            <Text style={styles.metaValue}>{data.family.email}</Text>
          </View>
        ) : null}
        {data.family.phone ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{lang.phone}:</Text>
            <Text style={styles.metaValue}>{data.family.phone}</Text>
          </View>
        ) : null}

        {/* Ledger */}
        <Text style={styles.sectionTitle}>{lang.ledger}</Text>

        {data.lines.length === 0 ? (
          <Text style={{ ...styles.cell, fontStyle: "italic", color: "#666" }}>{lang.empty}</Text>
        ) : (
          <View style={styles.table}>
            <View style={[styles.row, styles.rowHeader]}>
              <Text style={[styles.cell, styles.cellDate, { fontWeight: 700 }]}>{lang.dateCol}</Text>
              <Text style={[styles.cell, styles.cellDesc, { fontWeight: 700 }]}>{lang.descriptionCol}</Text>
              <Text style={[styles.cell, styles.cellAmount, { fontWeight: 700 }]}>{lang.chargeCol}</Text>
              <Text style={[styles.cell, styles.cellAmount, { fontWeight: 700 }]}>{lang.paymentCol}</Text>
              <Text style={[styles.cell, styles.cellAmount, { fontWeight: 700 }]}>{lang.balanceCol}</Text>
            </View>
            {data.lines.map((ln, i) => (
              <View key={i} style={styles.row}>
                <Text style={[styles.cell, styles.cellDate]}>{ln.date}</Text>
                <Text style={[styles.cell, styles.cellDesc]}>{ln.label}</Text>
                <Text style={[styles.cell, styles.cellAmount]}>
                  {ln.charge > 0 ? fmt(ln.charge, data.currency) : ""}
                </Text>
                <Text style={[styles.cell, styles.cellAmount]}>
                  {ln.payment > 0 ? fmt(ln.payment, data.currency) : ""}
                </Text>
                <Text style={[styles.cell, styles.cellAmount]}>{fmt(ln.balance, data.currency)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Totals */}
        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>{lang.totalCharged}:</Text>
            <Text style={styles.totalsValue}>{fmt(data.totalCharged, data.currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>{lang.totalPaid}:</Text>
            <Text style={styles.totalsValue}>{fmt(data.totalPaid, data.currency)}</Text>
          </View>
          <View style={[styles.totalsRow, styles.balanceDueRow]}>
            <Text style={styles.balanceDueLabel}>{lang.balanceDue}:</Text>
            <Text style={styles.balanceDueValue}>{fmt(data.balanceDue, data.currency)}</Text>
          </View>
        </View>

        {/* Payment instructions */}
        {settings.payment_instructions ? (
          <View style={styles.instructions}>
            <Text style={styles.instructionsTitle}>{lang.paymentInstructions}</Text>
            <Text style={styles.instructionsBody}>{settings.payment_instructions}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>{lang.footer}</Text>
      </Page>
    </Document>
  );
}

/** Render the statement PDF to a Buffer suitable for email attachment. */
export async function renderStatementPdf(
  data: StatementData,
  settings: Pick<EmailSettings, "org_name" | "org_address" | "org_logo_url" | "payment_instructions">,
  locale: "en" | "yi"
): Promise<Buffer> {
  const instance = pdf(<StatementDocument data={data} settings={settings} locale={locale} />);
  const stream = await instance.toBuffer();
  // @react-pdf/renderer's .toBuffer() returns a Node stream in v3; we need
  // to consume it into a single Buffer for nodemailer attachments.
  return await streamToBuffer(stream as unknown as NodeJS.ReadableStream);
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
