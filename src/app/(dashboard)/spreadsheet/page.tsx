"use client";

import Header from "@/components/Header";

export default function SpreadsheetPage() {
  return (
    <div>
      <Header titleKey="page.spreadsheet" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Tuition Spreadsheet
          </h3>
          <p className="text-gray-500">
            The AG Grid spreadsheet interface will be built in Phase 3.
            <br />
            It will mirror your Excel layout with family rows, monthly columns,
            payment dates, methods (COM), and amounts.
          </p>
        </div>
      </div>
    </div>
  );
}
