import type { PaymentMethod } from "./types";

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  crc: "Credit Card (crc)",
  kas: "Cash (kas)",
  bank: "Bank transfer",
  other: "Other",
};

export const METHOD_COLORS: Record<PaymentMethod, string> = {
  crc: "bg-blue-100 text-blue-700",
  kas: "bg-green-100 text-green-700",
  bank: "bg-purple-100 text-purple-700",
  other: "bg-gray-100 text-gray-600",
};

// Academic year months in order: Sep → Jul
export const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7];

export const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

export function formatEur(n: number) {
  return "€" + n.toLocaleString("nl-BE", { minimumFractionDigits: 2 });
}
