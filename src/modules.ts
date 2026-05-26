/**
 * Module registry — the hub at agent.gf.cx/ renders one card per entry.
 *
 * A module either has live data (status: "live" + a summary computed at
 * render time) or is a placeholder for a search Dan predicts he'll run
 * (status: "planned" — renders as a dashed-border card--placeholder).
 *
 * Placeholders are first-class: they set the expectation for what the
 * umbrella covers and let the hub feel populated from day one.
 *
 * To add a new live module:
 *   1. Add it to MODULES below with status: "live", detailPath, and
 *      summary(env) that returns the card fields.
 *   2. Wire its detailPath in src/index.ts to a renderer (today the only
 *      live module's renderer is renderDashboard in src/dashboard.ts).
 *
 * To promote a planned module to live:
 *   - Flip status to "live", add summary(env), wire the detailPath route.
 */

import type { Env, HistoryEntry } from "./index";

export interface ModuleSummary {
  /** Big number — latest priced value or "—" when nothing yet. */
  latest: string;
  /** Small line under the latest — source / "no priced match" / etc. */
  latestSub: string;
  /** Target / threshold framing (e.g., "≤ $1,099"). */
  target: string;
  /** Last-checked timestamp framing (e.g., "checked today 17:09 UTC"). */
  lastChecked: string;
  /** Latest priced value is at-or-below threshold — card gets accent treatment. */
  belowTarget: boolean;
}

export type ModuleStatus = "live" | "planned";

export interface ModuleEntry {
  id: string;
  /** Displayed name — first half. */
  name: string;
  /** Optional italic em emphasis (Newsreader). E.g., "watcher". */
  em?: string;
  /** Small uppercase kicker line above the name. */
  kicker: string;
  /** One-line framing of what the module watches. */
  blurb: string;
  /** Detail-page path (e.g., "/mac-mini/"). */
  detailPath: string;
  status: ModuleStatus;
  /** Live modules implement this; planned modules omit it. */
  summary?: (env: Env) => Promise<ModuleSummary>;
}

// ─── Mac mini watcher — module #1, live ─────────────────────────────────────

async function macMiniSummary(env: Env): Promise<ModuleSummary> {
  const TARGET_THRESHOLD = 1099;

  const raw = await env.HISTORY.get("history:v1");
  const history: HistoryEntry[] = raw ? safeParse(raw) : [];
  const priced = history.filter((h) => h.cheapest && h.cheapest.price !== null);
  const latestEntry = priced.at(-1) ?? null;
  const lastRunEntry = history.at(-1) ?? null;

  const latest = latestEntry?.cheapest?.price ?? null;
  const latestSource = latestEntry?.cheapest?.source ?? null;

  return {
    latest: latest !== null ? `$${latest.toFixed(0)}` : "—",
    latestSub: latestSource ?? "no priced match yet",
    target: `≤ $${TARGET_THRESHOLD.toLocaleString()}`,
    lastChecked: lastRunEntry
      ? `checked ${formatTimestamp(lastRunEntry.timestamp)}`
      : "awaiting first check",
    belowTarget: latest !== null && latest <= TARGET_THRESHOLD,
  };
}

function safeParse(raw: string): HistoryEntry[] {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const MODULES: ModuleEntry[] = [
  {
    id: "mac-mini",
    name: "Mac mini",
    em: "watcher",
    kicker: "Apple Refurbished",
    blurb: "M4 24GB/1TB · alert when cheaper than retail",
    detailPath: "/mac-mini/",
    status: "live",
    summary: macMiniSummary,
  },
  {
    id: "flights-uk",
    name: "Flights to",
    em: "UK",
    kicker: "Travel · calendar low",
    blurb: "PHL/NYC ↔ LHR/MAN one-way or RT · scanned across Google Flights / Kayak / Skyscanner",
    detailPath: "/flights-uk/",
    status: "planned",
  },
  {
    id: "ebay-sniffer",
    name: "eBay",
    em: "sniffer",
    kicker: "Marketplace · saved searches",
    blurb: "Lowest Buy-It-Now + closing-low auctions across saved searches (sanctioned eBay Browse API)",
    detailPath: "/ebay-sniffer/",
    status: "planned",
  },
  {
    id: "gbp-usd",
    name: "GBP",
    em: "/ USD",
    kicker: "FX rate · fluctuation",
    blurb: "Pound-sterling vs. dollar daily close · alert on sharp moves and 30-day extremes for cross-border transfers",
    detailPath: "/gbp-usd/",
    status: "planned",
  },
  {
    id: "eur-gbp",
    name: "EUR",
    em: "/ GBP",
    kicker: "FX rate · fluctuation",
    blurb: "Euro vs. pound-sterling daily close · the rate that moves on European-vendor purchases",
    detailPath: "/eur-gbp/",
    status: "planned",
  },
];
