import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase";
import type { Currency, FxSource, FxRateKind } from "@/lib/types";

/**
 * Foreign exchange helpers.
 *
 * All rates are stored as the amount of the non-EUR currency per 1 EUR
 * (matches ECB's convention: 1 EUR = 0.854 GBP, 1 EUR = 1.085 USD, etc.).
 * To convert an amount in currency C to EUR we divide: `amount_eur = amount_c / rate`.
 *
 * Rate lookup falls back to the most recent rate strictly before the
 * requested date. This matches standard banking behaviour for weekends
 * and holidays (ECB doesn't publish).
 */

export interface RateLookup {
  currency: Currency;
  date: string;     // YYYY-MM-DD we looked up FOR
  rateDate: string; // the YYYY-MM-DD whose rate we actually used
  rate: number;     // amount of `currency` per 1 EUR
  source: FxSource;
}

export interface ConvertResult {
  /** Converted amount in EUR, rounded to 2 decimals. */
  eur: number;
  /** The exact rate used (amount of source currency per 1 EUR). */
  rate: number;
  /** Date whose rate was actually used (may differ from request date
   *  when we fell back to the last-published rate). */
  rateDate: string;
  /** Source of the rate — 'ecb' or 'manual'. */
  source: FxSource;
  /** Echo of the input for convenience in breakdown UIs. */
  originalAmount: number;
  originalCurrency: Currency;
  /** The date originally asked for (YYYY-MM-DD). */
  date: string;
}

export interface MissingRate {
  currency: Currency;
  date: string;
}

/**
 * Resolve a single (date, currency) pair to a rate.
 * Returns `null` if no rate for or before that date exists.
 * EUR always resolves to rate=1.
 */
export async function getRate(
  date: string,
  currency: Currency,
): Promise<RateLookup | null> {
  if (currency === "EUR") {
    return {
      currency: "EUR",
      date,
      rateDate: date,
      rate: 1,
      source: "ecb",
    };
  }
  const db = createServerClient();
  const { data, error } = await db
    .from("exchange_rates")
    .select("date, rate, source")
    .eq("currency", currency)
    .lte("date", date)
    .order("date", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { date: string; rate: number; source: FxSource };
  return {
    currency,
    date,
    rateDate: row.date,
    rate: Number(row.rate),
    source: row.source,
  };
}

/**
 * Bulk-resolve rates for many (date, currency) pairs in a single query per
 * currency. Use this when building reports / totals where many payments
 * need conversion.
 *
 * Returns a Map keyed by `"${date}|${currency}"` with `RateLookup` values,
 * or `null` for that key if no rate is available.
 */
export async function getRatesBulk(
  pairs: Array<{ date: string; currency: Currency }>,
): Promise<Map<string, RateLookup | null>> {
  const out = new Map<string, RateLookup | null>();
  const byCurrency = new Map<Currency, Set<string>>();
  for (const p of pairs) {
    const key = `${p.date}|${p.currency}`;
    if (out.has(key)) continue;
    if (p.currency === "EUR") {
      out.set(key, {
        currency: "EUR",
        date: p.date,
        rateDate: p.date,
        rate: 1,
        source: "ecb",
      });
      continue;
    }
    if (!byCurrency.has(p.currency)) byCurrency.set(p.currency, new Set());
    byCurrency.get(p.currency)!.add(p.date);
  }
  if (byCurrency.size === 0) return out;
  const db = createServerClient();
  // Fetch all rows for each currency once, then pick the latest-before-date
  // per requested date in memory. For typical workloads (<500 rows) this is
  // much cheaper than one SELECT per payment.
  for (const [currency, dates] of Array.from(byCurrency.entries())) {
    const { data, error } = await db
      .from("exchange_rates")
      .select("date, rate, source")
      .eq("currency", currency)
      .order("date", { ascending: true });
    const dateList = Array.from(dates);
    if (error || !data) {
      for (const d of dateList) out.set(`${d}|${currency}`, null);
      continue;
    }
    const rows = data as Array<{ date: string; rate: number; source: FxSource }>;
    for (const d of dateList) {
      // Find the latest row with row.date <= d (binary search since rows
      // are sorted ascending).
      let lo = 0, hi = rows.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].date <= d) { found = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      const row = found >= 0 ? rows[found] : null;
      out.set(`${d}|${currency}`, row
        ? { currency, date: d, rateDate: row.date, rate: Number(row.rate), source: row.source }
        : null,
      );
    }
  }
  return out;
}

/**
 * Convert `amount` of `currency` on `date` to EUR. Returns `null` if no
 * rate is available (weekend/holiday with no prior rate either).
 */
export async function convertToEur(
  amount: number,
  currency: Currency,
  date: string,
): Promise<ConvertResult | null> {
  const lookup = await getRate(date, currency);
  if (!lookup) return null;
  const eur = currency === "EUR" ? amount : amount / lookup.rate;
  return {
    eur: Math.round(eur * 100) / 100,
    rate: lookup.rate,
    rateDate: lookup.rateDate,
    source: lookup.source,
    originalAmount: amount,
    originalCurrency: currency,
    date,
  };
}

/**
 * In-memory per-currency rate table used by bulk snapshot helpers.
 * Sorted ascending by date so we can binary-search for the latest-on-or-
 * before-a-date lookup.
 */
interface CurrencyRateTable {
  rows: Array<{ date: string; rate: number; source: FxSource }>;
  latest: { date: string; rate: number; source: FxSource } | null;
}

/** Load a rate table for one currency. Returns empty rows if none exist. */
async function loadRateTable(
  db: SupabaseClient,
  currency: Currency,
): Promise<CurrencyRateTable> {
  const { data, error } = await db
    .from("exchange_rates")
    .select("date, rate, source")
    .eq("currency", currency)
    .order("date", { ascending: true });
  if (error || !data) return { rows: [], latest: null };
  const rows = data as Array<{ date: string; rate: number; source: FxSource }>;
  const latest = rows.length > 0 ? rows[rows.length - 1] : null;
  return { rows, latest };
}

/** Pick the best rate for `date` from an in-memory table.
 *  - historical: latest row with row.date <= date
 *  - fallback:   earliest row whose date > date (or latest if none historical)
 *  Returns null only if the table is fully empty. */
function pickRate(
  table: CurrencyRateTable,
  date: string,
): { rate: number; rateDate: string; source: FxSource; kind: "historical" | "fallback" } | null {
  const { rows } = table;
  if (rows.length === 0) return null;
  // Binary search for latest row with row.date <= date.
  let lo = 0, hi = rows.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (found >= 0) {
    const r = rows[found];
    return { rate: Number(r.rate), rateDate: r.date, source: r.source, kind: "historical" };
  }
  // No historical row — use the earliest one we have (first in ascending list).
  const r = rows[0];
  return { rate: Number(r.rate), rateDate: r.date, source: r.source, kind: "fallback" };
}

/**
 * Resolve a rate for snapshotting an EUR equivalent on write. Tries the
 * historical rate first (latest rate ON OR BEFORE `date`); if no such
 * rate exists, falls back to the earliest later rate (or latest available
 * — whatever we have).
 *
 * If the `exchange_rates` table is empty for this currency, attempts a
 * one-shot ECB fetch to bootstrap it so a first-time USD/GBP payment on
 * a fresh install never saves with a NULL rate.
 *
 * EUR resolves to rate=1.
 */
export async function getRateForSnapshot(
  date: string,
  currency: Currency,
): Promise<(RateLookup & { kind: "historical" | "fallback" }) | null> {
  if (currency === "EUR") {
    return { currency: "EUR", date, rateDate: date, rate: 1, source: "ecb", kind: "historical" };
  }
  const db = createServerClient();
  let table = await loadRateTable(db, currency);
  if (table.rows.length === 0) {
    // Bootstrap: try ECB once, then reload.
    try {
      await fetchEcbDailyRates();
      table = await loadRateTable(db, currency);
    } catch {
      // Swallow — caller will see null and handle it.
    }
  }
  const picked = pickRate(table, date);
  if (!picked) return null;
  return {
    currency,
    date,
    rateDate: picked.rateDate,
    rate: picked.rate,
    source: picked.source,
    kind: picked.kind,
  };
}

/**
 * Compute the EUR snapshot fields (`eur_amount`, `eur_rate`,
 * `eur_rate_date`, `eur_rate_kind`) for a payment or charge, ready to
 * splat into an insert or update. Returns nulls if no rate is available
 * at all for the currency (the caller should surface this).
 */
export async function snapshotEurFields(
  amount: number,
  currency: Currency,
  date: string,
): Promise<{
  eur_amount: number | null;
  eur_rate: number | null;
  eur_rate_date: string | null;
  eur_rate_kind: FxRateKind | null;
}> {
  if (currency === "EUR") {
    return {
      eur_amount: Math.round(amount * 100) / 100,
      eur_rate: 1,
      eur_rate_date: date,
      eur_rate_kind: "historical",
    };
  }
  const lookup = await getRateForSnapshot(date, currency);
  if (!lookup) {
    return { eur_amount: null, eur_rate: null, eur_rate_date: null, eur_rate_kind: null };
  }
  const eur = amount / lookup.rate;
  return {
    eur_amount: Math.round(eur * 100) / 100,
    eur_rate: lookup.rate,
    eur_rate_date: lookup.rateDate,
    eur_rate_kind: lookup.kind,
  };
}

/** A row from `payments` that needs its EUR snapshot ensured. */
export interface PaymentEurRow {
  id: string;
  amount: number;
  currency: Currency | null;
  payment_date: string;
  eur_amount: number | null;
  eur_rate?: number | null;
  eur_rate_date?: string | null;
  eur_rate_kind?: FxRateKind | null;
}

/** A row from `charges` that needs its EUR snapshot ensured. */
export interface ChargeEurRow {
  id: string;
  amount: number;
  currency: Currency | null;
  month: number;
  year: number;
  eur_amount: number | null;
  eur_rate?: number | null;
  eur_rate_date?: string | null;
  eur_rate_kind?: FxRateKind | null;
}

/** Concurrency-bounded Promise.all. Avoids hammering the DB while still
 *  being orders of magnitude faster than pure sequential. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Self-heal: any row whose `eur_amount` is NULL gets a snapshot computed
 * now and persisted back. Batches rate lookups per currency (one SELECT
 * per currency in use) and writes updates with bounded concurrency.
 *
 * Mutates each row in place so callers can sum `eur_amount` afterwards
 * without checking for nulls.
 *
 * For a fresh DB where `exchange_rates` is empty for a currency, tries
 * to bootstrap from ECB once before giving up.
 */
export async function ensurePaymentEurAmounts(
  db: SupabaseClient,
  rows: PaymentEurRow[],
): Promise<void> {
  const missing = rows.filter((r) => r.eur_amount == null);
  if (missing.length === 0) return;

  // Group by currency, load each rate table once. Bootstrap if empty.
  const tables = await loadTablesForCurrencies(
    db,
    new Set(missing.map((r) => (r.currency ?? "EUR") as Currency)),
  );

  await mapWithLimit(missing, 8, async (r) => {
    const cur: Currency = (r.currency ?? "EUR") as Currency;
    const date = String(r.payment_date).slice(0, 10);
    const snap = snapshotFromTable(tables, cur, Number(r.amount), date);
    if (snap.eur_amount == null) return;
    await db.from("payments").update({
      eur_amount: snap.eur_amount,
      eur_rate: snap.eur_rate,
      eur_rate_date: snap.eur_rate_date,
      eur_rate_kind: snap.eur_rate_kind,
    }).eq("id", r.id);
    r.eur_amount = snap.eur_amount;
    r.eur_rate = snap.eur_rate;
    r.eur_rate_date = snap.eur_rate_date;
    r.eur_rate_kind = snap.eur_rate_kind;
  });
}

export async function ensureChargeEurAmounts(
  db: SupabaseClient,
  rows: ChargeEurRow[],
): Promise<void> {
  const missing = rows.filter((r) => r.eur_amount == null);
  if (missing.length === 0) return;

  const tables = await loadTablesForCurrencies(
    db,
    new Set(missing.map((r) => (r.currency ?? "EUR") as Currency)),
  );

  await mapWithLimit(missing, 8, async (r) => {
    const cur: Currency = (r.currency ?? "EUR") as Currency;
    const date = `${r.year}-${String(r.month).padStart(2, "0")}-01`;
    const snap = snapshotFromTable(tables, cur, Number(r.amount), date);
    if (snap.eur_amount == null) return;
    await db.from("charges").update({
      eur_amount: snap.eur_amount,
      eur_rate: snap.eur_rate,
      eur_rate_date: snap.eur_rate_date,
      eur_rate_kind: snap.eur_rate_kind,
    }).eq("id", r.id);
    r.eur_amount = snap.eur_amount;
    r.eur_rate = snap.eur_rate;
    r.eur_rate_date = snap.eur_rate_date;
    r.eur_rate_kind = snap.eur_rate_kind;
  });
}

/** Load rate tables for each requested currency. Bootstraps from ECB if
 *  any non-EUR currency has zero rows. */
async function loadTablesForCurrencies(
  db: SupabaseClient,
  currencies: Set<Currency>,
): Promise<Map<Currency, CurrencyRateTable>> {
  const tables = new Map<Currency, CurrencyRateTable>();
  let bootstrapped = false;
  for (const c of Array.from(currencies)) {
    if (c === "EUR") continue;
    let t = await loadRateTable(db, c);
    if (t.rows.length === 0 && !bootstrapped) {
      bootstrapped = true;
      try { await fetchEcbDailyRates(); } catch { /* ignore */ }
      t = await loadRateTable(db, c);
    }
    tables.set(c, t);
  }
  return tables;
}

/** Compute snapshot fields from a pre-loaded rate table (no DB calls). */
function snapshotFromTable(
  tables: Map<Currency, CurrencyRateTable>,
  currency: Currency,
  amount: number,
  date: string,
): {
  eur_amount: number | null;
  eur_rate: number | null;
  eur_rate_date: string | null;
  eur_rate_kind: FxRateKind | null;
} {
  if (currency === "EUR") {
    return {
      eur_amount: Math.round(amount * 100) / 100,
      eur_rate: 1,
      eur_rate_date: date,
      eur_rate_kind: "historical",
    };
  }
  const table = tables.get(currency);
  if (!table) return { eur_amount: null, eur_rate: null, eur_rate_date: null, eur_rate_kind: null };
  const picked = pickRate(table, date);
  if (!picked) return { eur_amount: null, eur_rate: null, eur_rate_date: null, eur_rate_kind: null };
  const eur = amount / picked.rate;
  return {
    eur_amount: Math.round(eur * 100) / 100,
    eur_rate: picked.rate,
    eur_rate_date: picked.rateDate,
    eur_rate_kind: picked.kind,
  };
}

/**
 * Snapshot of the most recent rate we know about for each non-EUR
 * currency. Used for the Settings UI ("last-known fallback rate") and
 * also the basis on which `getRateForSnapshot` falls back when no rate
 * exists for a payment's actual date.
 */
export async function getLatestKnownRates(): Promise<Array<{
  currency: Currency;
  rate: number;
  rateDate: string;
  source: FxSource;
}>> {
  const db = createServerClient();
  const out: Array<{ currency: Currency; rate: number; rateDate: string; source: FxSource }> = [];
  for (const c of ["USD", "GBP"] as Currency[]) {
    const { data } = await db
      .from("exchange_rates")
      .select("date, rate, source")
      .eq("currency", c)
      .order("date", { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      const row = data[0] as { date: string; rate: number; source: FxSource };
      out.push({ currency: c, rate: Number(row.rate), rateDate: row.date, source: row.source });
    }
  }
  return out;
}

/**
 * Given a set of (amount, currency, date) records, return:
 *  - `totalEur`         sum of EUR equivalents
 *  - `breakdown`        per-record conversion rows (for the expandable UI)
 *  - `missing`          any records whose rate couldn't be found
 */
export async function convertManyToEur(
  records: Array<{ amount: number; currency: Currency; date: string; id?: string }>,
): Promise<{
  totalEur: number;
  breakdown: Array<ConvertResult & { id?: string }>;
  missing: Array<MissingRate & { id?: string; amount: number }>;
}> {
  const lookups = await getRatesBulk(
    records.map((r) => ({ date: r.date, currency: r.currency })),
  );
  const breakdown: Array<ConvertResult & { id?: string }> = [];
  const missing: Array<MissingRate & { id?: string; amount: number }> = [];
  let totalEur = 0;
  for (const r of records) {
    const lookup = lookups.get(`${r.date}|${r.currency}`);
    if (!lookup) {
      missing.push({ id: r.id, amount: r.amount, currency: r.currency, date: r.date });
      continue;
    }
    const eur = r.currency === "EUR" ? r.amount : r.amount / lookup.rate;
    const rounded = Math.round(eur * 100) / 100;
    totalEur += rounded;
    breakdown.push({
      eur: rounded,
      rate: lookup.rate,
      rateDate: lookup.rateDate,
      source: lookup.source,
      originalAmount: r.amount,
      originalCurrency: r.currency,
      date: r.date,
      id: r.id,
    });
  }
  return { totalEur: Math.round(totalEur * 100) / 100, breakdown, missing };
}

/**
 * Fetch today's ECB daily reference rates and upsert them into the
 * `exchange_rates` table. Returns the set of (date, currency) pairs that
 * were written.
 *
 * `force = true` overwrites existing rows even if they were manually
 * edited; the default only inserts rows that don't yet exist.
 */
export async function fetchEcbDailyRates(opts: { force?: boolean } = {}): Promise<{
  date: string;
  inserted: Array<{ currency: string; rate: number }>;
  skipped: Array<{ currency: string; reason: string }>;
}> {
  const res = await fetch(
    "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`ECB fetch failed: HTTP ${res.status}`);
  const xml = await res.text();

  // Extract <Cube time='YYYY-MM-DD'> … <Cube currency='X' rate='Y' />
  // ECB actually publishes the XML with *single*-quoted attributes
  // (time='2024-01-15', currency='USD' rate='1.0891') — accept either
  // single or double quotes to stay robust if that ever changes.
  const timeMatch = xml.match(/<Cube\s+time\s*=\s*["'](\d{4}-\d{2}-\d{2})["']/);
  if (!timeMatch) throw new Error("ECB XML missing <Cube time=...>");
  const date = timeMatch[1];

  const rateRegex = /<Cube\s+currency\s*=\s*["']([A-Z]{3})["']\s+rate\s*=\s*["']([\d.]+)["']\s*\/?>/g;
  const parsed: Array<{ currency: string; rate: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = rateRegex.exec(xml)) !== null) {
    parsed.push({ currency: m[1], rate: parseFloat(m[2]) });
  }

  // We only care about currencies the app actually supports.
  const SUPPORTED = new Set<string>(["USD", "GBP"]);
  const usable = parsed.filter((p) => SUPPORTED.has(p.currency));

  const db = createServerClient();
  const inserted: Array<{ currency: string; rate: number }> = [];
  const skipped: Array<{ currency: string; reason: string }> = [];

  for (const p of usable) {
    if (!opts.force) {
      // Only insert if there's no row for that (date, currency) yet.
      const { data: existing } = await db
        .from("exchange_rates")
        .select("date")
        .eq("date", date)
        .eq("currency", p.currency)
        .limit(1);
      if (existing && existing.length > 0) {
        skipped.push({ currency: p.currency, reason: "already present" });
        continue;
      }
    }
    const { error } = await db
      .from("exchange_rates")
      .upsert(
        { date, currency: p.currency, rate: p.rate, source: "ecb" as FxSource },
        { onConflict: "date,currency" },
      );
    if (error) {
      skipped.push({ currency: p.currency, reason: error.message });
    } else {
      inserted.push(p);
    }
  }

  return { date, inserted, skipped };
}
