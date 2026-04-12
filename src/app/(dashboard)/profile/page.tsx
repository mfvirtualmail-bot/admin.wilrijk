"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { t, LOCALE_NAMES } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import Header from "@/components/Header";

export default function ProfilePage() {
  const { user, locale, refreshUser } = useAuth();
  const router = useRouter();

  const [language, setLanguage] = useState<Locale>((user?.language as Locale) ?? "en");
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    setError("");

    const body: Record<string, unknown> = { display_name: displayName, language };
    if (password.trim()) body.password = password.trim();

    const res = await fetch(`/api/users/${user?.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || t(locale, "common.error"));
    } else {
      setSuccess(t(locale, "profile.saved"));
      setPassword("");
      await refreshUser();
      // Redirect to reload with new locale if changed
      if (language !== locale) router.refresh();
    }
    setSaving(false);
  }

  return (
    <div>
      <Header titleKey="page.profile" />
      <div className="p-6 max-w-lg">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">{t(locale, "page.profile")}</h2>

          {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">{error}</div>}
          {success && <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-md p-3 text-sm">{success}</div>}

          <form onSubmit={handleSave} className="space-y-4">
            {/* Username — read only */}
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t(locale, "login.username")}</label>
              <p className="text-gray-900 font-mono text-sm bg-gray-50 px-3 py-2 rounded-md border border-gray-200">{user?.username}</p>
            </div>

            {/* Display name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t(locale, "profile.displayName")}</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Language selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t(locale, "profile.language")}</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(LOCALE_NAMES) as Locale[]).map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => setLanguage(loc)}
                    className={`py-2 px-3 rounded-md border text-sm font-medium transition-colors ${
                      language === loc
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    } ${loc === "yi" ? "font-serif" : ""}`}
                    dir={loc === "yi" ? "rtl" : "ltr"}
                  >
                    {LOCALE_NAMES[loc]}
                  </button>
                ))}
              </div>
              {language !== locale && (
                <p className="mt-1 text-xs text-blue-600">{t(locale, "profile.languageHint")}</p>
              )}
            </div>

            {/* New password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t(locale, "profile.newPassword")} <span className="text-gray-400 font-normal">({t(locale, "profile.leaveBlank")})</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Role — read only */}
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t(locale, "profile.role")}</label>
              <p className="text-gray-900 text-sm">
                {user?.is_super_admin
                  ? <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-semibold">Super Admin</span>
                  : <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">User</span>
                }
              </p>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium disabled:opacity-50 transition-colors"
              >
                {saving ? t(locale, "common.loading") : t(locale, "common.save")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
