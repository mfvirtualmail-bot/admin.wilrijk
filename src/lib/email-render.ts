import type { StatementData } from "./statement-data";
import type { EmailSettings, Currency } from "./types";

const SYM: Record<Currency, string> = { EUR: "€", USD: "$", GBP: "£" };

function fmtCurrency(n: number, currency: Currency = "EUR"): string {
  return (SYM[currency] ?? "€") + n.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The placeholders a template author can use inside subject + body. */
export const TEMPLATE_PLACEHOLDERS = [
  { key: "family_name", description: "Family surname (English)" },
  { key: "hebrew_family_name", description: "Family surname (Hebrew)" },
  { key: "father_name", description: "Father's name (English)" },
  { key: "hebrew_father_name", description: "Father's name (Hebrew)" },
  { key: "contact_name", description: "Best-available English contact name" },
  { key: "hebrew_contact_name", description: "Best-available Hebrew contact name" },
  { key: "children_names", description: "Child first names, comma-separated (English)" },
  { key: "hebrew_children_names", description: "Child Hebrew names, comma-separated" },
  { key: "balance", description: "Current balance due, formatted with currency" },
  { key: "total_charged", description: "Total charges to date, formatted" },
  { key: "total_paid", description: "Total payments to date, formatted" },
  { key: "statement_date", description: "Today's date, yyyy-mm-dd" },
  { key: "org_name", description: "Organisation name from settings" },
] as const;

export type TemplateVars = Record<(typeof TEMPLATE_PLACEHOLDERS)[number]["key"], string>;

export function buildTemplateVars(data: StatementData, settings: Pick<EmailSettings, "org_name">): TemplateVars {
  const fatherName = data.family.father_name?.trim() ?? "";
  const motherName = data.family.mother_name?.trim() ?? "";
  const hebrewFatherName = data.family.hebrew_father_name?.trim() ?? "";
  const hebrewFamilyName = data.family.hebrew_name?.trim() ?? "";

  const contactName = fatherName || motherName || data.family.name;
  // Hebrew contact falls back sensibly: hebrew father name → hebrew family
  // name → English contact name. Never empty.
  const hebrewContactName = hebrewFatherName || hebrewFamilyName || contactName;

  // First names only — the family surname is already carried by
  // {{family_name}} / {{hebrew_family_name}}, so printing "David Cohen,
  // Sarah Cohen" duplicates it awkwardly.
  const childrenNames = data.children
    .map((c) => (c.first_name ?? "").trim())
    .filter(Boolean)
    .join(", ");

  // Hebrew child names. When a child has no hebrew_name recorded we fall
  // back to the English first name so the list is never empty.
  const hebrewChildrenNames = data.children
    .map((c) => (c.hebrew_name?.trim() || c.first_name?.trim() || ""))
    .filter(Boolean)
    .join(", ");

  return {
    family_name: data.family.name,
    hebrew_family_name: hebrewFamilyName,
    father_name: fatherName,
    hebrew_father_name: hebrewFatherName,
    contact_name: contactName,
    hebrew_contact_name: hebrewContactName,
    children_names: childrenNames,
    hebrew_children_names: hebrewChildrenNames,
    balance: fmtCurrency(data.balanceDue, data.currency),
    total_charged: fmtCurrency(data.totalCharged, data.currency),
    total_paid: fmtCurrency(data.totalPaid, data.currency),
    statement_date: data.statementDate,
    org_name: settings.org_name,
  };
}

/** Replace {{placeholder}} tokens in a template string. Unknown placeholders
 * are left as-is so authors can spot typos. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, name: string) => {
    const key = name.toLowerCase() as keyof TemplateVars;
    if (key in vars) return vars[key];
    return match;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert the gabbai's plain-text body (with blank-line paragraphs) into a
 * branded HTML email. Safe against HTML injection — the author's text is
 * escaped first. Always rendered RTL with a Hebrew-capable font stack. */
export function renderHtmlEmail(
  bodyPlain: string,
  settings: Pick<EmailSettings, "org_name" | "org_address" | "org_logo_url">,
): string {
  const dir = "rtl";
  const fontStack = "'Noto Sans Hebrew', 'SBL Hebrew', 'Frank Ruehl CLM', Arial, sans-serif";

  const paragraphs = bodyPlain
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");

  const logo = settings.org_logo_url
    ? `<img src="${escapeHtml(settings.org_logo_url)}" alt="${escapeHtml(settings.org_name)}" style="height:48px;width:auto;display:block;margin-bottom:8px;" />`
    : "";

  const address = settings.org_address
    ? `<div style="font-size:12px;color:#666;margin-top:4px;">${escapeHtml(settings.org_address).replace(/\n/g, "<br/>")}</div>`
    : "";

  return `<!doctype html>
<html dir="${dir}" lang="yi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(settings.org_name)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;font-family:${fontStack};">
            <tr>
              <td style="padding:24px 28px 16px 28px;border-bottom:1px solid #eee;text-align:${dir === "rtl" ? "right" : "left"};" dir="${dir}">
                ${logo}
                <div style="font-size:18px;font-weight:700;color:#111;">${escapeHtml(settings.org_name)}</div>
                ${address}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;font-size:15px;line-height:1.55;color:#222;text-align:${dir === "rtl" ? "right" : "left"};" dir="${dir}">
                ${paragraphs}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px;border-top:1px solid #eee;background:#fafafa;font-size:11px;color:#888;text-align:${dir === "rtl" ? "right" : "left"};" dir="${dir}">
                ${escapeHtml(settings.org_name)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
