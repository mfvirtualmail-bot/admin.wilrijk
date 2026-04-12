"use client";

import { useAuth } from "@/lib/auth-context";
import { t } from "@/lib/i18n";
import Header from "@/components/Header";

export default function DashboardPage() {
  const { user, locale } = useAuth();

  const cards = [
    {
      titleKey: "dashboard.totalFamilies",
      value: "—",
      color: "bg-blue-50 text-blue-700",
    },
    {
      titleKey: "dashboard.totalChildren",
      value: "—",
      color: "bg-green-50 text-green-700",
    },
    {
      titleKey: "dashboard.totalReceived",
      value: "€ —",
      color: "bg-emerald-50 text-emerald-700",
    },
    {
      titleKey: "dashboard.totalOutstanding",
      value: "€ —",
      color: "bg-red-50 text-red-700",
    },
  ];

  return (
    <div>
      <Header titleKey="nav.dashboard" />
      <div className="p-6">
        <p className="text-lg text-gray-600 mb-6">
          {t(locale, "dashboard.welcome")}, {user?.display_name}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {cards.map((card) => (
            <div
              key={card.titleKey}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
            >
              <p className="text-sm font-medium text-gray-500">
                {t(locale, card.titleKey)}
              </p>
              <p className={`text-3xl font-bold mt-2 ${card.color} inline-block px-2 py-1 rounded`}>
                {card.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-3">
            Phase 0 — Foundation
          </h3>
          <p className="text-gray-500">
            Dashboard data will be populated once families, children, and
            payments are added in Phase 2.
          </p>
        </div>
      </div>
    </div>
  );
}
