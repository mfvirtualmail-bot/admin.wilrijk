"use client";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { getDirection } from "@/lib/i18n";
import Sidebar from "@/components/Sidebar";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, locale, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-500 text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null; // middleware will redirect
  }

  return (
    <div className="flex min-h-screen" dir={getDirection(locale)}>
      <Sidebar />
      <main className="flex-1 bg-gray-50">{children}</main>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}
