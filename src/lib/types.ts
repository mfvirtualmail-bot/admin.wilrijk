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
  address: string | null;
  city: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
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

export type PaymentMethod = "crc" | "kas" | "bank" | "other";

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
  | "settings";

export type PermissionAction = "view" | "add" | "edit" | "delete";

export const ALL_MODULES: PermissionModule[] = [
  "families",
  "children",
  "charges",
  "payments",
  "spreadsheet",
  "reports",
  "users",
  "settings",
];

export const ALL_ACTIONS: PermissionAction[] = ["view", "add", "edit", "delete"];

export const MODULE_ACTIONS: Record<PermissionModule, PermissionAction[]> = {
  families: ["view", "add", "edit", "delete"],
  children: ["view", "add", "edit", "delete"],
  charges: ["view", "add", "edit", "delete"],
  payments: ["view", "add", "edit", "delete"],
  spreadsheet: ["view", "edit"],
  reports: ["view"],
  users: ["view", "add", "edit", "delete"],
  settings: ["view", "edit"],
};
