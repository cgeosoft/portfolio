/**
 * Metric selection contract shared by the Bun main process and the webview.
 * Keeps built-in metric ids, defaults, dashboard capacity, and preference
 * validation in one place so the Metrics tab and the stored portfolio
 * configuration cannot drift apart.
 */

/** Dashboard slot of a metric that is added to a portfolio. */
export type MetricSlot = "large" | "compact";

/** Number of dashboard slots per size. */
export const METRIC_SLOT_CAPACITY: Readonly<Record<MetricSlot, number>> = { large: 4, compact: 6 };

/** Per-portfolio state of a single metric. */
export interface PortfolioMetricPreference {
  /** Metric id, matches the manifest `id`. */
  id: string;
  /** Present in the Metrics tab of the portfolio. */
  added: boolean;
  /** Dashboard slot. `null` means added, but not shown on the overview. */
  slot: MetricSlot | null;
  /** Position in the list. */
  order: number;
  /** Dashboard place within the slot, 0 to capacity - 1. Missing means the first free place. */
  place?: number;
}

/** Ids of the metrics bundled with the application, in catalog order. */
export const BUILTIN_METRIC_IDS = [
  "total-portfolio-value",
  "day-gain-loss",
  "lifetime-gain",
  "cash-liquidity",
  "invested-capital",
  "holdings-cost",
  "realized-pnl",
  "dividends-interest",
  "broker-fees",
  "taxes-withheld",
] as const;

export type BuiltinMetricId = (typeof BUILTIN_METRIC_IDS)[number];

/**
 * Keys used by the first version of the metric selection, before metrics
 * became installable modules. Stored preferences may still use them.
 */
export const LEGACY_METRIC_KEY_TO_ID: Readonly<Record<string, BuiltinMetricId>> = {
  totalPortfolioValue: "total-portfolio-value",
  dayGainLoss: "day-gain-loss",
  lifetimeGain: "lifetime-gain",
  cashLiquidity: "cash-liquidity",
  investedCapital: "invested-capital",
  holdingsCost: "holdings-cost",
  realizedPnL: "realized-pnl",
  dividendsInterest: "dividends-interest",
  brokerFees: "broker-fees",
  taxesWithheld: "taxes-withheld",
};

/**
 * Default selection. It reproduces the metric layout that the overview page
 * used before the Metrics tab: four large cards and six compact tiles.
 */
export const DEFAULT_METRIC_PREFERENCES: readonly PortfolioMetricPreference[] = BUILTIN_METRIC_IDS.map(
  (id, index) => ({
    id,
    added: true,
    slot: index < METRIC_SLOT_CAPACITY.large ? "large" : "compact",
    order: index,
    place: index < METRIC_SLOT_CAPACITY.large ? index : index - METRIC_SLOT_CAPACITY.large,
  }),
);

const METRIC_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A metric id is kebab-case, 3 to 64 characters. */
export function isMetricId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= 64 && METRIC_ID_PATTERN.test(value);
}

export function isBuiltinMetricId(value: unknown): value is BuiltinMetricId {
  return typeof value === "string" && (BUILTIN_METRIC_IDS as readonly string[]).includes(value);
}

/** Return a fresh copy of the default preference list. */
export function getDefaultMetricPreferences(): PortfolioMetricPreference[] {
  return DEFAULT_METRIC_PREFERENCES.map((pref) => ({ ...pref }));
}

function readSlot(value: unknown): MetricSlot | null {
  return value === "large" || value === "compact" ? value : null;
}

/**
 * Convert one stored entry to the current model. Accepts the current shape
 * (`{id, added, slot, order}`) and the legacy shape (`{key, enabled, size}`).
 * Returns null for entries that do not name a valid metric.
 */
function readPlace(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readPreference(raw: unknown): Omit<PortfolioMetricPreference, "order"> | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;

  if ("key" in entry && !("id" in entry)) {
    const id = LEGACY_METRIC_KEY_TO_ID[String(entry["key"])];
    if (!id) return null;
    const enabled = typeof entry["enabled"] === "boolean" ? entry["enabled"] : true;
    return { id, added: true, slot: enabled ? readSlot(entry["size"]) ?? "large" : null };
  }

  if (!isMetricId(entry["id"])) return null;
  const added = typeof entry["added"] === "boolean" ? entry["added"] : true;
  const slot = added ? readSlot(entry["slot"]) : null;
  return { id: entry["id"], added, slot, place: slot ? readPlace(entry["place"]) : undefined };
}

/**
 * Validate an unknown preference list. Unknown or duplicate ids are dropped,
 * legacy entries are migrated, built-in metrics that the list does not
 * mention are appended as added but not slotted, and the dashboard capacity
 * (4 large, 6 compact) is enforced. Entries over the capacity keep their
 * place in the list with `slot: null`, so nothing is lost. `order` is
 * rewritten from the array order. Every slotted entry gets a unique `place`:
 * a valid stored one is kept, the others take the first free place.
 */
export function normalizeMetricPreferences(input: unknown): PortfolioMetricPreference[] {
  const result: PortfolioMetricPreference[] = [];
  const seen = new Set<string>();
  const used: Record<MetricSlot, number> = { large: 0, compact: 0 };

  const push = (pref: Omit<PortfolioMetricPreference, "order">) => {
    let slot = pref.added ? pref.slot : null;
    if (slot) {
      if (used[slot] >= METRIC_SLOT_CAPACITY[slot]) {
        slot = null;
      } else {
        used[slot] += 1;
      }
    }
    result.push({ id: pref.id, added: pref.added, slot, order: result.length, ...(slot ? { place: pref.place } : {}) });
    seen.add(pref.id);
  };

  if (Array.isArray(input)) {
    for (const raw of input) {
      const pref = readPreference(raw);
      if (!pref || seen.has(pref.id)) continue;
      push(pref);
    }
  }

  const isFresh = result.length === 0;
  for (const pref of DEFAULT_METRIC_PREFERENCES) {
    if (seen.has(pref.id)) continue;
    push(isFresh ? pref : { id: pref.id, added: true, slot: null });
  }

  assignPlaces(result);
  return result;
}

/** Keep each valid, unique stored place; give the other slotted entries the first free place. */
function assignPlaces(prefs: PortfolioMetricPreference[]): void {
  const taken: Record<MetricSlot, Set<number>> = { large: new Set(), compact: new Set() };
  const unplaced: PortfolioMetricPreference[] = [];
  for (const pref of prefs) {
    if (!pref.slot) {
      delete pref.place;
      continue;
    }
    const place = pref.place;
    if (place !== undefined && place < METRIC_SLOT_CAPACITY[pref.slot] && !taken[pref.slot].has(place)) {
      taken[pref.slot].add(place);
    } else {
      unplaced.push(pref);
    }
  }
  for (const pref of unplaced) {
    const used = taken[pref.slot!];
    let place = 0;
    while (used.has(place)) place += 1;
    used.add(place);
    pref.place = place;
  }
}

/** Parse a stored JSON string. Invalid or empty values fall back to defaults. */
export function parseMetricPreferences(json: string | null | undefined): PortfolioMetricPreference[] {
  if (!json) return getDefaultMetricPreferences();
  try {
    return normalizeMetricPreferences(JSON.parse(json));
  } catch {
    return getDefaultMetricPreferences();
  }
}

/** Serialize a preference list for storage. */
export function serializeMetricPreferences(prefs: PortfolioMetricPreference[]): string {
  return JSON.stringify(normalizeMetricPreferences(prefs));
}

/** Count the dashboard slots in use, per size. */
export function countMetricSlots(prefs: readonly PortfolioMetricPreference[]): Record<MetricSlot, number> {
  const used: Record<MetricSlot, number> = { large: 0, compact: 0 };
  for (const pref of prefs) {
    if (pref.added && pref.slot) used[pref.slot] += 1;
  }
  return used;
}

// ── Selection edits ──────────────────────────────────────────────────────────
// Pure helpers the Metrics tab uses to build the next list before saving it.
// Every result goes through normalizeMetricPreferences, so capacity holds.

/** Add a metric to the portfolio. It takes a free slot of its default size when one exists. */
export function withMetricAdded(
  prefs: readonly PortfolioMetricPreference[],
  id: string,
  preferredSlot: MetricSlot | null = null,
): PortfolioMetricPreference[] {
  const used = countMetricSlots(prefs);
  const slot = preferredSlot && used[preferredSlot] < METRIC_SLOT_CAPACITY[preferredSlot] ? preferredSlot : null;
  const existing = prefs.find((pref) => pref.id === id);
  const next = existing
    ? prefs.map((pref) => (pref.id === id ? { ...pref, added: true, slot: pref.added ? pref.slot : slot } : pref))
    : [...prefs, { id, added: true, slot, order: prefs.length }];
  return normalizeMetricPreferences(next);
}

/** Remove a metric from the portfolio. The entry stays with `added: false` so it is not re-added. */
export function withMetricRemoved(prefs: readonly PortfolioMetricPreference[], id: string): PortfolioMetricPreference[] {
  return normalizeMetricPreferences(
    prefs.map((pref) => (pref.id === id ? { ...pref, added: false, slot: null, place: undefined } : pref)),
  );
}

/** Move a metric to a dashboard slot, or off the dashboard with `null`. Returns null when the slot is full. */
export function withMetricSlot(
  prefs: readonly PortfolioMetricPreference[],
  id: string,
  slot: MetricSlot | null,
): PortfolioMetricPreference[] | null {
  const current = prefs.find((pref) => pref.id === id);
  if (!current || !current.added) return null;
  if (slot && current.slot !== slot && countMetricSlots(prefs)[slot] >= METRIC_SLOT_CAPACITY[slot]) return null;
  if (slot === current.slot) return normalizeMetricPreferences(prefs);
  return normalizeMetricPreferences(prefs.map((pref) => (pref.id === id ? { ...pref, slot, place: undefined } : pref)));
}

/**
 * Put a metric on dashboard `place` of `slot`, adding it to the portfolio when
 * needed. A metric already on that place swaps with it: it takes the moved
 * metric's old slot and place, or leaves the dashboard when the moved metric
 * had none. Other metrics keep their places. Returns null when the place is
 * out of range or the slot is full.
 */
export function withMetricPlaced(
  prefs: readonly PortfolioMetricPreference[],
  id: string,
  slot: MetricSlot,
  place: number,
): PortfolioMetricPreference[] | null {
  if (!Number.isInteger(place) || place < 0 || place >= METRIC_SLOT_CAPACITY[slot]) return null;
  const current = prefs.find((pref) => pref.id === id);
  const from = current?.added && current.slot ? { slot: current.slot, place: current.place } : null;
  const occupant = prefs.find((pref) => pref.id !== id && pref.added && pref.slot === slot && pref.place === place);
  if (!occupant && from?.slot !== slot && countMetricSlots(prefs)[slot] >= METRIC_SLOT_CAPACITY[slot]) return null;
  const list = prefs.map((pref): PortfolioMetricPreference => {
    if (pref.id === id) return { ...pref, added: true, slot, place };
    if (pref === occupant) return from ? { ...pref, slot: from.slot, place: from.place } : { ...pref, slot: null, place: undefined };
    return pref;
  });
  if (!current) list.push({ id, added: true, slot, place, order: list.length });
  return normalizeMetricPreferences(list);
}

/** Move a metric one step among the entries that share its slot. */
export function withMetricMoved(
  prefs: readonly PortfolioMetricPreference[],
  id: string,
  direction: -1 | 1,
): PortfolioMetricPreference[] {
  const list = [...prefs];
  const index = list.findIndex((pref) => pref.id === id);
  if (index < 0) return list;
  const slot = list[index].slot;
  let target = index + direction;
  while (target >= 0 && target < list.length && list[target].slot !== slot) target += direction;
  if (target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target], list[index]];
  return normalizeMetricPreferences(list);
}
