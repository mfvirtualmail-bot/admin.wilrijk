"use client";

import Header from "@/components/Header";

export default function ReportsPage() {
  return (
    <div>
      <Header titleKey="page.reports" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">📈</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Reports & Analytics
          </h3>
          <p className="text-gray-500">
            Reporting dashboards and data export will be built in Phase 5.
          </p>
        </div>
      </div>
    </div>
  );
}
