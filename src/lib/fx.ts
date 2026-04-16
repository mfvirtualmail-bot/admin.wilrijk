import { createServerClient } from "@/lib/supabase";
import type { Currency, FxSource } from "@/lib/types";

/**
 * Foreign-exchange helpers.
 *
 * All rates are stored as the amount of the non-EUR currency per 1 EUR
 * (matches ECB's convention: 1 EUR = 0.854 GBP, 1 EUR = 1.085 USD, etc.).
 * To convert an amount in currency C to EUR we divide: `amount_eur = amount_c / rate`.
 *
 * STORAGE: rates live in a single row of the `settings` table (key = 'fx_rates'),
 * not a dedicated `exchange_rates` table. This avoids requiring a DB migration
 * step for deploys and matches the rest of the app's KV-style config.
 *
 * The value JSONB shape is:
 *
 *   {
 *     "2026-04-16": {
 *       "USD": { "rate": 1.0891, "source": "ecb",    "updated_at": "..." },
 *       "GBP": { "rate": 0.8543, "source": "manual", "updated_at": "..." }
 *     },
 *     "2026-04-15": { ... }
 *   }
 *
 * Rate lookup falls back to the most recent rate strictly before the
 * requested date. This matches standard banking behaviour for weekends
 * and holidays (ECB doesn't publish those days). If no rate of any kind
 * is on record, `convertManyToEur` uses a 1:1 EUR fallback and flags the
 * record as `approximated` so the UI can warn the user — losing a whole
 * charge from the dashboard total because a rate was missing caused a
 * real "outstanding balance dropped to €0" incident and is never
 * acceptable.
 */

const SETTINGS_KEY = "fx_rates";

/** Per-currency per-date entry stored in the settings JSON. */
interface FxEntry {
  rate: number;
  source: FxSource;
  updated_at: string;
}

/** Full map stored under settings.fx_rates. */
type FxMap = Record<string, Partial<Record<Currency, FxEntry>>>;

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
  /** True if we couldn't find a real rate and used 1:1 as a fallback.
   *  Callers should surface this so the user knows the number isn't
   *  authoritative. */
  approximated: boolean;
}

export interface MissingRate {
  currency: Currency;
  date: string;
}

/** Raw row shape returned to the Advanced-settings rate list. */
export interface RateRow {
  date: string;
  currency: Currency;
  rate: number;
  source: FxSource;
  updated_at: string;
}

// ──────────────────────────────────────────────
// Low-level settings read/write helpers
// ──────────────────────────────────────────────

async function readMap(): Promise<FxMap> {
  const db = createServerClient();
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .limit(1);
  if (error || !data || data.length === 0) return {};
  const v = (data[0] as { value: unknown }).value;
  if (!v || typeof v !== "object") return {};
  return v as FxMap;
}

async function writeMap(map: FxMap): Promise<void> {
  const db = createServerClient();
  const { error } = await db
    .from("settings")
    .upsert(
      { key: SETTINGS_KEY, value: map, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(`Failed to persist FX map: ${error.message}`);
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Return all rates as a flat list, newest-date first. Used by the
 * Advanced Settings list view. `filter.currency` optionally narrows
 * to one currency.
 */
export async function listRates(filter: { currency?: Currency } = {}): Promise<RateRow[]> {
  const map = await readMap();
  const rows: RateRow[] = [];
  for (const [date, byCurrency] of Object.entries(map)) {
    for (const [cur, entry] of Object.entries(byCurrency)) {
      if (!entry) continue;
      if (filter.currency && cur !== filter.currency) continue;
      rows.push({
        date,
        currency: cur as Currency,
        rate: entry.rate,
        source: entry.source,
        updated_at: entry.updated_at,
      });
    }
  }
  rows.sort((a, b) => (a.date === b.date ? a.currency.localeCompare(b.currency) : a.date < b.date ? 1 : -1));
  return rows;
}

/** Upsert a single rate (manual entries + ECB writes both go through here). */
export async function putRate(
  date: string,
  currency: Currency,
  rate: number,
  source: FxSource,
): Promise<void> {
  const map = await readMap();
  if (!map[date]) map[date] = {};
  map[date]![currency] = { rate, source, updated_at: new Date().toISOString() };
  await writeMap(map);
}

/** Delete a single rate. */
export async function deleteRate(date: string, currency: Currency): Promise<void> {
  const map = await readMap();
  if (map[date] && map[date]![currency]) {
    delete map[date]![currency];
    if (Object.keys(map[date]!).length === 0) delete map[date];
    await writeMap(map);
  }
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
    return { currency: "EUR", date, rateDate: date, rate: 1, source: "ecb" };
  }
  const map = await readMap();
  const hit = findNewestOnOrBefore(map, date, currency);
  if (!hit) return null;
  return { currency, date, rateDate: hit.date, rate: hit.entry.rate, source: hit.entry.source };
}

/**
 * Bulk-resolve rates for many (date, currency) pairs. One DB read, rest in memory.
 * Returns a Map keyed by `"${date}|${currency}"` with `RateLookup` values,
 * or `null` for that key if no rate is available.
 */
export async function getRatesBulk(
  pairs: Array<{ date: string; currency: Currency }>,
): Promise<Map<string, RateLookup | null>> {
  const out = new Map<string, RateLookup | null>();
  const map = await readMap();
  for (const p of pairs) {
    const key = `${p.date}|${p.currency}`;
    if (out.has(key)) continue;
    if (p.currency === "EUR") {
      out.set(key, { currency: "EUR", date: p.date, rateDate: p.date, rate: 1, source: "ecb" });
      continue;
    }
    const hit = findNewestOnOrBefore(map, p.date, p.currency);
    out.set(key, hit
      ? { currency: p.currency, date: p.date, rateDate: hit.date, rate: hit.entry.rate, source: hit.entry.source }
      : null,
    );
  }
  return out;
}

/** Find the most recent rate with date ≤ target for a given currency. */
function findNewestOnOrBefore(
  map: FxMap,
  target: string,
  currency: Currency,
): { date: string; entry: FxEntry } | null {
  let best: { date: string; entry: FxEntry } | null = null;
  for (const [date, byCurrency] of Object.entries(map)) {
    if (date > target) continue;
    const entry = byCurrency?.[currency];
    if (!entry) continue;
    if (!best || date > best.date) best = { date, entry };
  }
  return best;
}

/**
 * Convert `amount` of `currency` on `date` to EUR. Returns `null` if no
 * rate is available.
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
    approximated: false,
  };
}

/**
 * Given a set of (amount, currency, date) records, return:
 *  - `totalEur`         sum of EUR equivalents (incl. 1:1 approximations)
 *  - `breakdown`        per-record conversion rows (for the expandable UI)
 *  - `missing`          records that needed a 1:1 fallback (same records
 *                       also appear in `breakdown` with approximated=true)
 *
 * SAFETY: when a rate is missing we treat the amount as EUR at face value
 * rather than excluding it from the total. Dropping items made the
 * dashboard's "outstanding balance" collapse to €0 when the FX table was
 * missing, which looked like a catastrophic data loss to the user. An
 * approximated total with a clear warning is always better than silently
 * omitting real charges.
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
      // 1:1 fallback — include in the total but flag it.
      missing.push({ id: r.id, amount: r.amount, currency: r.currency, date: r.date });
      const rounded = Math.round(r.amount * 100) / 100;
      totalEur += rounded;
      breakdown.push({
        eur: rounded,
        rate: 1,
        rateDate: r.date,
        source: "manual",
        originalAmount: r.amount,
        originalCurrency: r.currency,
        date: r.date,
        id: r.id,
        approximated: true,
      });
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
      approximated: false,
    });
  }
  return { totalEur: Math.round(totalEur * 100) / 100, breakdown, missing };
}

// ──────────────────────────────────────────────
// ECB fetch (daily + 90-day history)
// ──────────────────────────────────────────────

const SUPPORTED = new Set<Currency>(["USD", "GBP"]);

/**
 * Fetch ECB reference rates and upsert them into the settings JSON.
 *
 * Ranges:
 *   - "daily"   → today only (tiny payload; used by the nightly cron)
 *   - "90d"     → last 90 calendar days (~60 KB)
 *   - "2y"      → last 2 years (default; fetches the full history file
 *                 and filters client-side so the stored map stays
 *                 bounded — ECB doesn't publish a 2-year file directly)
 *
 * `force = true` overwrites existing rows (manual edits included).
 * Default only writes rates the map doesn't have yet.
 */
export async function fetchEcbDailyRates(
  opts: { force?: boolean; range?: "daily" | "90d" | "2y" } = {},
): Promise<{
  date: string;             // most recent date written
  inserted: Array<{ date: string; currency: string; rate: number }>;
  skipped: Array<{ date: string; currency: string; reason: string }>;
}> {
  const range = opts.range ?? "2y";
  const url =
    range === "daily" ? "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
    : range === "90d" ? "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"
    : "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";

  // For the 2-year range, cut anything older than this. Gives a clean
  // rolling window regardless of when the fetch runs.
  const cutoffIso = (() => {
    if (range !== "2y") return null;
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().slice(0, 10);
  })();

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ECB fetch failed: HTTP ${res.status}`);
  const xml = await res.text();

  // ECB uses *single*-quoted attributes but we accept either. Each
  // `<Cube time='YYYY-MM-DD'>` block contains one day's rates as
  // `<Cube currency='USD' rate='1.0891'/>` children.
  const dayBlockRe = /<Cube\s+time\s*=\s*["'](\d{4}-\d{2}-\d{2})["']\s*>([\s\S]*?)<\/Cube>/g;
  const innerRateRe = /<Cube\s+currency\s*=\s*["']([A-Z]{3})["']\s+rate\s*=\s*["']([\d.]+)["']\s*\/?>/g;

  const parsed: Array<{ date: string; currency: Currency; rate: number }> = [];
  let dayMatch: RegExpExecArray | null;
  while ((dayMatch = dayBlockRe.exec(xml)) !== null) {
    const date = dayMatch[1];
    // Trim early when a cutoff is in effect — the full history file is
    // ~25 years and we only need the rolling 2-year window.
    if (cutoffIso && date < cutoffIso) continue;
    const inner = dayMatch[2];
    let rm: RegExpExecArray | null;
    while ((rm = innerRateRe.exec(inner)) !== null) {
      const currency = rm[1] as Currency;
      if (!SUPPORTED.has(currency)) continue;
      parsed.push({ date, currency, rate: parseFloat(rm[2]) });
    }
  }

  if (parsed.length === 0) {
    // Fallback regex for the daily file which may be flat (no outer
    // time-scoped block wrapping the rates — historically the daily file
    // puts the time on an enclosing Cube with no `>...</Cube>` pair).
    const flatDate = xml.match(/<Cube\s+time\s*=\s*["'](\d{4}-\d{2}-\d{2})["']/);
    if (!flatDate) throw new Error("ECB XML missing <Cube time=...>");
    const date = flatDate[1];
    if (!cutoffIso || date >= cutoffIso) {
      const flatRe = /<Cube\s+currency\s*=\s*["']([A-Z]{3})["']\s+rate\s*=\s*["']([\d.]+)["']\s*\/?>/g;
      let fm: RegExpExecArray | null;
      while ((fm = flatRe.exec(xml)) !== null) {
        const currency = fm[1] as Currency;
        if (!SUPPORTED.has(currency)) continue;
        parsed.push({ date, currency, rate: parseFloat(fm[2]) });
      }
    }
  }

  if (parsed.length === 0) {
    throw new Error("ECB XML parsed 0 rates — format change?");
  }

  const map = await readMap();
  const inserted: Array<{ date: string; currency: string; rate: number }> = [];
  const skipped: Array<{ date: string; currency: string; reason: string }> = [];
  const now = new Date().toISOString();

  for (const p of parsed) {
    const existing = map[p.date]?.[p.currency];
    if (existing && !opts.force) {
      // Don't overwrite manual edits; also don't re-count ECB rows.
      skipped.push({ date: p.date, currency: p.currency, reason: "already present" });
      continue;
    }
    if (!map[p.date]) map[p.date] = {};
    map[p.date]![p.currency] = { rate: p.rate, source: "ecb", updated_at: now };
    inserted.push(p);
  }

  await writeMap(map);

  // Most recent date in the parsed batch.
  const mostRecent = parsed.reduce((a, b) => (a.date > b.date ? a : b)).date;
  return { date: mostRecent, inserted, skipped };
}
