import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSettings, EmailTemplate } from "./types";
import { buildFamilyStatement } from "./statement-data";
import { renderStatementPdf } from "./pdf-statement";
import { renderTemplate, renderHtmlEmail, buildTemplateVars } from "./email-render";

export interface SendOneResult {
  ok: boolean;
  to: string;
  familyId: string;
  subject: string;
  error?: string;
  balance?: number;
}

/** Fetch the email settings singleton. Returns null if SMTP creds are missing. */
export async function getEmailSettings(db: SupabaseClient): Promise<EmailSettings | null> {
  const { data } = await db.from("email_settings").select("*").eq("id", 1).single();
  if (!data) return null;
  return data as EmailSettings;
}

export async function getEmailTemplate(
  db: SupabaseClient,
  locale: "en" | "yi"
): Promise<EmailTemplate | null> {
  const { data } = await db.from("email_templates").select("*").eq("locale", locale).single();
  return (data as EmailTemplate) ?? null;
}

/** Build a configured nodemailer transporter. Throws if SMTP creds missing. */
export function buildTransporter(settings: EmailSettings) {
  if (!settings.smtp_user || !settings.smtp_password) {
    throw new Error("SMTP credentials not configured. Set them in Settings → Email.");
  }
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_secure,
    auth: {
      user: settings.smtp_user,
      pass: settings.smtp_password,
    },
  });
}

export interface SendStatementOptions {
  db: SupabaseClient;
  familyId: string;
  settings: EmailSettings;
  template: EmailTemplate;
  overrideTo?: string;        // for test sends — redirect to a different address
  transporter?: nodemailer.Transporter;
  sentBy?: string | null;
  isTest?: boolean;
}

/** Render + send one family's statement. Also records it in email_log. */
export async function sendFamilyStatement(opts: SendStatementOptions): Promise<SendOneResult> {
  const { db, familyId, settings, template, overrideTo, sentBy, isTest } = opts;

  const data = await buildFamilyStatement(db, familyId);
  if (!data) {
    return { ok: false, to: "", familyId, subject: "", error: "Family not found" };
  }

  const to = overrideTo ?? data.family.email ?? "";
  if (!to) {
    await logEmail(db, {
      family_id: familyId,
      to_email: "",
      subject: template.subject,
      locale: template.locale,
      status: "failed",
      error: "Family has no email address",
      sent_by: sentBy ?? null,
      balance_at_send: data.balanceDue,
    });
    return { ok: false, to: "", familyId, subject: template.subject, error: "Family has no email address" };
  }

  const vars = buildTemplateVars(data, settings);
  const subject = renderTemplate(template.subject, vars);
  const body = renderTemplate(template.body, vars);
  const html = renderHtmlEmail(body, settings, template.locale);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderStatementPdf(data, settings, template.locale);
  } catch (e) {
    const err = e instanceof Error ? e.message : "PDF render failed";
    await logEmail(db, {
      family_id: familyId,
      to_email: to,
      subject,
      locale: template.locale,
      status: "failed",
      error: `PDF: ${err}`,
      sent_by: sentBy ?? null,
      balance_at_send: data.balanceDue,
    });
    return { ok: false, to, familyId, subject, error: `PDF: ${err}`, balance: data.balanceDue };
  }

  const transporter = opts.transporter ?? buildTransporter(settings);
  const fromEmail = settings.from_email || settings.smtp_user || "";
  const pdfName = `statement-${data.family.name.replace(/[^a-z0-9]+/gi, "_")}-${data.statementDate}.pdf`;

  try {
    await transporter.sendMail({
      from: fromEmail ? `"${settings.from_name}" <${fromEmail}>` : settings.from_name,
      to,
      replyTo: settings.reply_to || undefined,
      bcc: settings.bcc_admin || undefined,
      subject,
      text: body,
      html,
      attachments: [
        {
          filename: pdfName,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    await logEmail(db, {
      family_id: familyId,
      to_email: to,
      subject,
      locale: template.locale,
      status: isTest ? "test" : "sent",
      error: null,
      sent_by: sentBy ?? null,
      balance_at_send: data.balanceDue,
    });

    return { ok: true, to, familyId, subject, balance: data.balanceDue };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Send failed";
    await logEmail(db, {
      family_id: familyId,
      to_email: to,
      subject,
      locale: template.locale,
      status: "failed",
      error: err,
      sent_by: sentBy ?? null,
      balance_at_send: data.balanceDue,
    });
    return { ok: false, to, familyId, subject, error: err, balance: data.balanceDue };
  }
}

interface LogRow {
  family_id: string | null;
  to_email: string;
  subject: string;
  locale: string;
  status: "sent" | "failed" | "test";
  error: string | null;
  sent_by: string | null;
  balance_at_send: number | null;
}

async function logEmail(db: SupabaseClient, row: LogRow) {
  await db.from("email_log").insert(row);
}
