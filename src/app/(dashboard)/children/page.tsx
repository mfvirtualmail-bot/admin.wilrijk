"use client";

import Header from "@/components/Header";

export default function ChildrenPage() {
  return (
    <div>
      <Header titleKey="page.children" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">🎓</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Student Roster
          </h3>
          <p className="text-gray-500">
            Full CRUD for children/students will be built in Phase 2.
            <br />
            Manage student records, class assignments, and monthly tuition amounts.
          </p>
        </div>
      </div>
    </div>
  );
}
