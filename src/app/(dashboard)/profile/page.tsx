"use client";

import { useAuth } from "@/lib/auth-context";
import { t, LOCALE_NAMES } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import Header from "@/components/Header";

export default function ProfilePage() {
  const { user, locale } = useAuth();

  return (
    <div>
      <Header titleKey="page.profile" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 max-w-lg">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">
            {t(locale, "page.profile")}
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500">
                {t(locale, "login.username")}
              </label>
              <p className="text-gray-900 mt-1">{user?.username}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-500">
                Display Name
              </label>
              <p className="text-gray-900 mt-1">{user?.display_name}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-500">
                Language
              </label>
              <p className="text-gray-900 mt-1">
                {LOCALE_NAMES[(user?.language as Locale) || "en"]}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-500">
                Role
              </label>
              <p className="text-gray-900 mt-1">
                {user?.is_super_admin ? "Super Admin" : "User"}
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-400 mt-6">
            Profile editing will be available in a future update.
          </p>
        </div>
      </div>
    </div>
  );
}
