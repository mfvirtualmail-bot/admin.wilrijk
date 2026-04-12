import en from "@/locales/en.json";
import nl from "@/locales/nl.json";
import yi from "@/locales/yi.json";

export type Locale = "en" | "nl" | "yi";

const dictionaries: Record<Locale, Record<string, string>> = { en, nl, yi };

export const RTL_LOCALES: Locale[] = ["yi"];

export function t(locale: Locale, key: string): string {
  return dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
}

export function isRTL(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function getDirection(locale: Locale): "ltr" | "rtl" {
  return isRTL(locale) ? "rtl" : "ltr";
}

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  nl: "Nederlands",
  yi: "ייִדיש",
};
