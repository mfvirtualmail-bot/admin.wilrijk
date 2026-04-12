"use client";

import Header from "@/components/Header";

export default function UsersPage() {
  return (
    <div>
      <Header titleKey="page.users" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">👤</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            User Management
          </h3>
          <p className="text-gray-500">
            User management and permission matrix will be built in Phase 1.
            <br />
            Create users with granular module-level permissions.
          </p>
        </div>
      </div>
    </div>
  );
}
