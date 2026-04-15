export interface User {
  id: string;
  username: string;
  display_name: string;
  language: "en" | "nl" | "yi";
  is_super_admin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export type Currency = "EUR" | "USD" | "GBP";

export interface Family {
  id: string;
  name: string;
  father_name: string | null;
  mother_name: string | null;
  hebrew_name: string | null;
  hebrew_father_name: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  language: "en" | "yi";
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Child {
  id: string;
  family_id: string;
  first_name: string;
  last_name: string;
  hebrew_name: string | null;
  date_of_birth: string | null;
  class_name: string | null;
  monthly_tuition: number;
  currency: Currency;
  is_active: boolean;
  enrollment_date: string | null;
  enrollment_start_month: number | null;
  enrollment_start_year: number | null;
  enrollment_end_month: number | null;
  enrollment_end_year: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Charge {
  id: string;
  child_id: string;
  family_id: string;
  month: number;
  year: number;
  amount: number;
  currency: Currency;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentMethod = string;
/** The four built-in payment method codes. Users can define additional
 * codes via Settings → Payment Methods; those codes are plain strings
 * that flow through the same column (VARCHAR) in the database. */
export const BUILTIN_PAYMENT_METHODS = ["crc", "kas", "bank", "other"] as const;

export interface Payment {
  id: string;
  family_id: string;
  amount: number;
  currency: Currency;
  payment_date: string;
  payment_method: PaymentMethod;
  month: number | null;
  year: number | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Permission {
  module: string;
  action: string;
}

export type PermissionModule =
  | "families"
  | "children"
  | "charges"
  | "payments"
  | "spreadsheet"
  | "reports"
  | "users"
  | "settings"
  | "email";

export type PermissionAction = "view" | "add" | "edit" | "delete" | "send";

export const ALL_MODULES: PermissionModule[] = [
  "families",
  "children",
  "charges",
  "payments",
  "spreadsheet",
  "reports",
  "users",
  "settings",
  "email",
];

export const ALL_ACTIONS: PermissionAction[] = ["view", "add", "edit", "delete", "send"];

export const MODULE_ACTIONS: Record<PermissionModule, PermissionAction[]> = {
  families: ["view", "add", "edit", "delete"],
  children: ["view", "add", "edit", "delete"],
  charges: ["view", "add", "edit", "delete"],
  payments: ["view", "add", "edit", "delete"],
  spreadsheet: ["view", "edit"],
  reports: ["view"],
  users: ["view", "add", "edit", "delete"],
  settings: ["view", "edit"],
  email: ["send"],
};

// Email-related types
export interface EmailSettings {
  id: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string | null;
  smtp_password: string | null; // never returned to the browser
  from_name: string;
  from_email: string | null;
  reply_to: string | null;
  bcc_admin: string | null;
  org_name: string;
  org_address: string | null;
  org_logo_url: string | null;
  payment_instructions: string | null;
  updated_at: string;
}

export interface EmailTemplate {
  locale: "en" | "yi";
  subject: string;
  body: string;
  updated_at: string;
}

export interface EmailLogEntry {
  id: string;
  family_id: string | null;
  to_email: string;
  subject: string;
  locale: string;
  status: "sent" | "failed" | "test";
  error: string | null;
  sent_by: string | null;
  balance_at_send: number | null;
  created_at: string;
}
