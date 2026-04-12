"use client";

import { useAuth } from "@/lib/auth-context";
import { t, LOCALE_NAMES } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

interface HeaderProps {
  titleKey: string;
}

export default function Header({ titleKey }: HeaderProps) {
  const { user, locale } = useAuth();

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <h2 className="text-xl font-semibold text-gray-800">
        {t(locale, titleKey)}
      </h2>
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span>{LOCALE_NAMES[locale as Locale]}</span>
        <span className="font-medium text-gray-700">
          {user?.display_name}
        </span>
      </div>
    </header>
  );
}
