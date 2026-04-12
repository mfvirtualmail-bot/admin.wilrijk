"use client";

import Header from "@/components/Header";

export default function PaymentsPage() {
  return (
    <div>
      <Header titleKey="page.payments" />
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">💶</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Payment History
          </h3>
          <p className="text-gray-500">
            Payment management will be built in Phase 2.
            <br />
            Track payments per family with date, method (crc/kas/bank), and
            amount in EUR.
          </p>
        </div>
      </div>
    </div>
  );
}
