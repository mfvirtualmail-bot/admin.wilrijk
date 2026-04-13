"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { t } from "@/lib/i18n";
import Header from "@/components/Header";
import { formatEur } from "@/lib/payment-utils";

interface DashboardStats {
  families: number;
  children: number;
  totalPaid: number;
  totalDue: number;
  totalCharged: number;
  monthlyExpected: number;
}

interface RecentPayment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  currency?: string;
  families: { name: string; father_name: string | null } | null;
}

const METHOD_SHORT: Record<string, string> = { crc: "CRC", kas: "KAS", bank: "BANK", other: "—" };

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

export default function DashboardPage() {
  const { user, locale } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.stats) { setStats(d.stats); setRecentPayments(d.recentPayments); }
      })
      .finally(() => setLoading(false));
  }, []);

  const paidPercent = stats && stats.totalCharged > 0
    ? Math.min(100, Math.round((stats.totalPaid / stats.totalCharged) * 100))
    : 0;

  const cards = [
    {
      key: "families",
      label: t(locale, "dashboard.totalFamilies"),
      value: loading ? "…" : String(stats?.families ?? 0),
      bg: "bg-blue-50",
      text: "text-blue-700",
      icon: "👨‍👩‍👧‍👦",
      href: "/families",
    },
    {
      key: "children",
      label: t(locale, "dashboard.totalChildren"),
      value: loading ? "…" : String(stats?.children ?? 0),
      bg: "bg-indigo-50",
      text: "text-indigo-700",
      icon: "🎓",
      href: "/children",
    },
    {
      key: "paid",
      label: t(locale, "dashboard.totalReceived"),
      value: loading ? "…" : formatEur(stats?.totalPaid ?? 0),
      bg: "bg-green-50",
      text: "text-green-700",
      icon: "💶",
      href: "/payments",
    },
    {
      key: "due",
      label: t(locale, "dashboard.totalOutstanding"),
      value: loading ? "…" : formatEur(stats?.totalDue ?? 0),
      bg: "bg-red-50",
      text: "text-red-600",
      icon: "⚠️",
      href: "/payments",
    },
  ];

  return (
    <div>
      <Header titleKey="nav.dashboard" />
      <div className="p-6 space-y-6">
        {/* Welcome */}
        <p className="text-lg text-gray-600">
          {t(locale, "dashboard.welcome")}, <strong>{user?.display_name}</strong>
        </p>

        {/* Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card) => (
            <Link key={card.key} href={card.href}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-gray-500">{card.label}</p>
                <span className="text-2xl">{card.icon}</span>
              </div>
              <p className={`text-3xl font-bold mt-2 ${card.text}`}>{card.value}</p>
            </Link>
          ))}
        </div>

        {/* Progress bar */}
        {stats && stats.totalCharged > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">{t(locale, "dashboard.collectionProgress")}</span>
              <span className="text-sm font-bold text-gray-900">{paidPercent}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div
                className={`h-4 rounded-full transition-all duration-500 ${paidPercent >= 100 ? "bg-green-500" : paidPercent >= 60 ? "bg-yellow-400" : "bg-red-500"}`}
                style={{ width: `${paidPercent}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-500">
              <span>{t(locale, "dashboard.paid")}: {formatEur(stats.totalPaid)}</span>
              <span>{t(locale, "dashboard.charged")}: {formatEur(stats.totalCharged)}</span>
            </div>
          </div>
        )}

        {/* Two-column: recent payments + quick links */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent payments */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-gray-800">{t(locale, "dashboard.recentPayments")}</h3>
              <Link href="/payments" className="text-xs text-blue-600 hover:underline">{t(locale, "dashboard.viewAll")}</Link>
            </div>
            {loading ? (
              <p className="text-gray-400 text-sm">{t(locale, "common.loading")}</p>
            ) : recentPayments.length === 0 ? (
              <p className="text-gray-400 text-sm">{t(locale, "dashboard.noPayments")}</p>
            ) : (
              <div className="space-y-2">
                {recentPayments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{p.families ? (p.families.father_name ? `${p.families.name} (${p.families.father_name})` : p.families.name) : "—"}</p>
                      <p className="text-xs text-gray-500">{formatDate(p.payment_date)} · <span className="font-mono">{METHOD_SHORT[p.payment_method] ?? p.payment_method}</span></p>
                    </div>
                    <span className="text-sm font-semibold text-green-700">{formatEur(Number(p.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-800 mb-3">{t(locale, "dashboard.quickActions")}</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: "/families/new", label: t(locale, "dashboard.addFamily"), icon: "👨‍👩‍👧‍👦" },
                { href: "/payments/new", label: t(locale, "dashboard.addPayment"), icon: "💶" },
                { href: "/spreadsheet", label: t(locale, "page.spreadsheet"), icon: "📋" },
                { href: "/families", label: t(locale, "dashboard.viewFamilies"), icon: "📋" },
              ].map((action) => (
                <Link key={action.href} href={action.href}
                  className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm text-gray-700 font-medium">
                  <span>{action.icon}</span>
                  <span>{action.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
