"use client";

import Header from "@/components/Header";

export default function SettingsPage() {
  return (
    <div>
      <Header titleKey="page.settings" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">⚙️</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            System Settings
          </h3>
          <p className="text-gray-500">
            Settings management will be built in Phase 6.
            <br />
            Configure school name, academic year, and other system preferences.
          </p>
        </div>
      </div>
    </div>
  );
}
