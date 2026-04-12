"use client";

import Header from "@/components/Header";

export default function UserDetailPage() {
  return (
    <div>
      <Header titleKey="page.users" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">👤</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            User Detail & Permissions
          </h3>
          <p className="text-gray-500">
            User detail view with permission checkbox matrix
            will be built in Phase 1.
          </p>
        </div>
      </div>
    </div>
  );
}
