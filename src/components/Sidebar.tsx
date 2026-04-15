"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { t } from "@/lib/i18n";

interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
}

const mainNav: NavItem[] = [
  { href: "/", labelKey: "nav.dashboard", icon: "📊" },
  { href: "/spreadsheet", labelKey: "nav.spreadsheet", icon: "📋" },
  { href: "/families", labelKey: "nav.families", icon: "👨‍👩‍👧‍👦" },
  { href: "/children", labelKey: "nav.children", icon: "🎓" },
  { href: "/payments", labelKey: "nav.payments", icon: "💶" },
  { href: "/reports", labelKey: "nav.reports", icon: "📈" },
];

const emailNav: NavItem = { href: "/emails", labelKey: "nav.emails", icon: "✉️" };

const adminNav: NavItem[] = [
  { href: "/admin/users", labelKey: "nav.users", icon: "👤" },
  { href: "/settings/email", labelKey: "nav.email_settings", icon: "📧" },
  { href: "/settings/email-templates", labelKey: "nav.email_templates", icon: "📝" },
  { href: "/settings", labelKey: "nav.settings", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, locale, logout, can } = useAuth();
  const canSendEmail = can("email", "send");

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-lg font-bold">{t(locale, "app.title")}</h1>
        <p className="text-xs text-gray-400">{t(locale, "app.subtitle")}</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {mainNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              isActive(item.href)
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <span>{item.icon}</span>
            <span>{t(locale, item.labelKey)}</span>
          </Link>
        ))}

        {canSendEmail && (
          <Link
            href={emailNav.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              isActive(emailNav.href)
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <span>{emailNav.icon}</span>
            <span>{t(locale, emailNav.labelKey)}</span>
          </Link>
        )}

        {user?.is_super_admin && (
          <>
            <div className="pt-4 pb-1 px-3">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {t(locale, "nav.admin")}
              </span>
            </div>
            {adminNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive(item.href)
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <span>{item.icon}</span>
                <span>{t(locale, item.labelKey)}</span>
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="p-3 border-t border-gray-700">
        <Link
          href="/profile"
          className="flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
        >
          <span>👤</span>
          <span className="truncate">{user?.display_name}</span>
        </Link>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-red-400 rounded-md transition-colors mt-1"
        >
          <span>🚪</span>
          <span>{t(locale, "nav.logout")}</span>
        </button>
      </div>
    </aside>
  );
}
