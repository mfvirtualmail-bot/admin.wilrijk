"use client";

import Header from "@/components/Header";

export default function FamilyDetailPage() {
  return (
    <div>
      <Header titleKey="page.families" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">👨‍👩‍👧‍👦</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Family Detail
          </h3>
          <p className="text-gray-500">
            Family detail view with children, charges, and payment history
            will be built in Phase 2.
          </p>
        </div>
      </div>
    </div>
  );
}
