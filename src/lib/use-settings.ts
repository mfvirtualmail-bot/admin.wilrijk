"use client";

import { useEffect, useState } from "react";
import { METHOD_LABELS as BUILTIN_METHOD_LABELS } from "./payment-utils";

/**
 * Client-side hook to fetch the user-configurable bits of /api/settings
 * that forms need (payment method labels, default payment method).
 *
 * The returned map merges the built-in defaults with whatever the
 * super-admin has saved in Settings → Payment Methods, so new custom
 * methods appear in every dropdown without further changes.
 */
export function usePaymentMethods() {
  const [methodLabels, setMethodLabels] = useState<Record<string, string>>({
    ...BUILTIN_METHOD_LABELS,
  });
  const [defaultMethod, setDefaultMethod] = useState<string>("kas");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.settings) return;
        if (d.settings.payment_method_labels) {
          setMethodLabels({
            ...BUILTIN_METHOD_LABELS,
            ...(d.settings.payment_method_labels as Record<string, string>),
          });
        }
        if (d.settings.default_payment_method) {
          setDefaultMethod(d.settings.default_payment_method as string);
        }
      })
      .catch(() => {
        // Fall back to built-in labels silently.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { methodLabels, defaultMethod, loaded };
}
