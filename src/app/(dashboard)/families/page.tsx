"use client";

import Header from "@/components/Header";

export default function FamiliesPage() {
  return (
    <div>
      <Header titleKey="page.families" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">👨‍👩‍👧‍👦</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Family Management
          </h3>
          <p className="text-gray-500">
            Full CRUD for families will be built in Phase 2.
            <br />
            Add, edit, and manage family records with contact information.
          </p>
        </div>
      </div>
    </div>
  );
}
