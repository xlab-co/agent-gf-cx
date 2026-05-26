/**
 * Mac mini M4 24GB/1TB price watcher — Cloudflare Worker
 *
 * Triggers:
 *   - Cron (daily 09:00 UTC) → checkAndAlert()
 *   - GET /                  → HTML dashboard (CF Access-protected)
 *   - GET /api/history       → JSON of last 365 runs
 *   - GET /api/check         → run check now, return result (CF Access)
 *   - GET /api/test-alert    → fire the alert path with current price (CF Access)
 *
 * Bindings (configured in wrangler.toml):
 *   - KV namespace `HISTORY` for daily-result history
 *   - Secret `WEBHOOK_URL` (optional) — Zapier/ntfy/Slack catch URL
 *   - Secret `RESEND_API_KEY`   (optional) — Resend Bearer token for email
 *   - Secret `RESEND_FROM`      (optional) — verified sender (e.g. agent@gf.cx)
 *   - Secret `RESEND_TO`        (optional) — email recipient (e.g. dan@gf.cx)
 *
 * SMS uses a provider abstraction (src/sms.ts) — the first configured
 * provider wins. To switch providers, set the new provider's secrets;
 * unsetting the old one is optional.
 *   - sms.to:  SMSTO_API_KEY + SMSTO_TO
 *   - twilio:  TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM + TWILIO_TO
 *
 * Each notification channel is independent — set the secrets for the
 * channels you want, omit the rest. Channels that fire successfully don't
 * stop the others from firing.
 */

import { renderDashboard } from "./dashboard";
import { checkApple, type PriceResult } from "./sources";
import { pickSmsProvider } from "./sms";

export interface Env {
  HISTORY: KVNamespace;
  WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_TO?: string;
  // SMS — first configured provider wins (see src/sms.ts)
  SMSTO_API_KEY?: string;
  SMSTO_TO?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  TWILIO_TO?: string;
}

const TARGET = {
  chip: "M4",
  ram: "24GB",
  storage: "1TB",
  retail: 1199.0,
  threshold: 1099.0,
};

export default {
  // Manual access (dashboard, debug endpoints)
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/history") {
      const history = await loadHistory(env);
      return Response.json(history);
    }

    if (url.pathname === "/api/check") {
      const result = await runCheck(env, { dryRun: true });
      return Response.json(result);
    }

    if (url.pathname === "/api/test-alert") {
      // Force the alert path AND skip persistence so the synthesized
      // test cheapest never lands in KV history.
      const result = await runCheck(env, { forceAlert: true, dryRun: true });
      return Response.json(result);
    }

    if (url.pathname === "/" || url.pathname === "") {
      const history = await loadHistory(env);
      return new Response(renderDashboard(history, TARGET), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },

  // Cron trigger (09:00 UTC daily — see wrangler.toml)
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCheck(env, {}));
  },
};

// ─── Core logic ──────────────────────────────────────────────────────────────

interface CheckRunOptions {
  forceAlert?: boolean;
  dryRun?: boolean;
}

// Persisted to KV — frozen history of what each check found.
export interface HistoryEntry {
  timestamp: string;
  cheapest: PriceResult | null;
  all: PriceResult[];
}

// Returned to caller — history fact + whether this run fired an alert.
interface CheckRunResult extends HistoryEntry {
  alertFired: boolean;
}

async function runCheck(env: Env, opts: CheckRunOptions): Promise<CheckRunResult> {
  const timestamp = new Date().toISOString();
  const all: PriceResult[] = [];

  // Reference price (Apple Direct configurator — static)
  all.push({
    source: "Apple Direct",
    name: `Mac mini ${TARGET.chip} ${TARGET.ram}/${TARGET.storage}`,
    price: TARGET.retail,
    url: "https://www.apple.com/shop/buy-mac/mac-mini",
  });

  // Live sources
  try {
    const refurb = await checkApple(TARGET);
    all.push(...refurb);
  } catch (e) {
    all.push({
      source: "Apple Refurbished",
      name: "fetch error",
      price: null,
      url: "https://www.apple.com/shop/refurbished/mac/mac-mini",
      error: (e as Error).message,
    });
  }

  let cheapest = pickCheapest(all);

  // Test-alert fallback — when forceAlert is on but no real priced result
  // exists, synthesize a clearly-labelled test cheapest so the notification
  // path can be exercised end-to-end. Never persisted to history (the
  // dryRun-or-test-alert branch below skips appendHistory anyway).
  if (opts.forceAlert && !cheapest) {
    cheapest = {
      source: "TEST · synthesized",
      name: `Mac mini ${TARGET.chip} ${TARGET.ram}/${TARGET.storage} — END-TO-END TEST, not a real match`,
      price: 999.0,
      url: "https://www.apple.com/shop/refurbished/mac/mac-mini",
    };
  }

  const entry = { timestamp, cheapest, all };

  // Persist (unless this was a manual dry-run "/api/check")
  if (!opts.dryRun) {
    await appendHistory(env, entry);
  }

  // Alert decision
  const shouldAlert =
    opts.forceAlert ||
    (cheapest !== null &&
      cheapest.price !== null &&
      cheapest.price <= TARGET.threshold &&
      cheapest.source !== "Apple Direct");

  if (shouldAlert && cheapest) {
    await notify(env, cheapest);
  }

  return { ...entry, alertFired: shouldAlert };
}

function pickCheapest(results: PriceResult[]): PriceResult | null {
  const priced = results.filter(
    (r) => r.price !== null && r.source !== "Apple Direct",
  );
  if (priced.length === 0) return null;
  return priced.reduce((a, b) => ((a.price ?? Infinity) < (b.price ?? Infinity) ? a : b));
}

// ─── History (KV) ────────────────────────────────────────────────────────────

const HISTORY_KEY = "history:v1";

async function loadHistory(env: Env): Promise<HistoryEntry[]> {
  const raw = await env.HISTORY.get(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function appendHistory(env: Env, entry: HistoryEntry): Promise<void> {
  const history = await loadHistory(env);
  history.push(entry);
  const trimmed = history.slice(-365);
  await env.HISTORY.put(HISTORY_KEY, JSON.stringify(trimmed));
}

// ─── Notifications ───────────────────────────────────────────────────────────

async function notify(env: Env, cheapest: PriceResult): Promise<void> {
  const savings = TARGET.retail - (cheapest.price ?? 0);
  const pct = (savings / TARGET.retail) * 100;
  const subject = `Mac mini ${TARGET.chip} ${TARGET.ram}/${TARGET.storage} — $${cheapest.price?.toFixed(2)} at ${cheapest.source}`;
  const body = [
    subject,
    "",
    `Saves $${savings.toFixed(2)} (${pct.toFixed(1)}% off $${TARGET.retail.toFixed(2)} retail)`,
    "",
    `Product: ${cheapest.name}`,
    `Source:  ${cheapest.source}`,
    `Link:    ${cheapest.url}`,
    "",
    `Detected: ${new Date().toISOString()}`,
  ].join("\n");

  // Webhook (Zapier, ntfy.sh, Slack, etc.)
  if (env.WEBHOOK_URL) {
    try {
      const resp = await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: subject,
          title: "Mac mini deal found",
          message: body,
          data: cheapest,
        }),
      });
      if (!resp.ok) {
        console.error(`Webhook non-2xx: ${resp.status}`, await resp.text());
      }
    } catch (e) {
      console.error("Webhook threw:", e);
    }
  }

  // Email via Resend (free tier: 100/day, 3000/month).
  // Requires RESEND_FROM to be a verified domain in the Resend dashboard;
  // domain verification adds 4 DNS records (DKIM + SPF + return-path).
  if (env.RESEND_API_KEY && env.RESEND_FROM && env.RESEND_TO) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: `agent.gf.cx <${env.RESEND_FROM}>`,
          to: [env.RESEND_TO],
          subject,
          text: body,
        }),
      });
      if (!resp.ok) {
        console.error(`Resend non-2xx: ${resp.status}`, await resp.text());
      }
    } catch (e) {
      console.error("Resend threw:", e);
    }
  }

  // SMS — provider abstraction picks the first configured provider.
  // Today (2026-05-26): sms.to is the active route. Twilio remains a
  // fallback in the code but is blocked by A2P 10DLC for US recipients —
  // see memory `project_twilio_us_sms_blocked_10dlc_2026-05-26.md`.
  const smsProvider = pickSmsProvider(env);
  if (smsProvider) {
    // Tight SMS body — under the 160-char single-segment limit when possible.
    const smsBody =
      `Mac mini ${TARGET.chip} ${TARGET.ram}/${TARGET.storage}: ` +
      `$${cheapest.price?.toFixed(2)} (saves $${savings.toFixed(0)}) ` +
      `at ${cheapest.source} — ${cheapest.url}`;

    try {
      const result = await smsProvider.send(env, { body: smsBody });
      if (!result.ok) {
        console.error(`SMS via ${smsProvider.name} failed:`, result.error);
      }
    } catch (e) {
      console.error(`SMS via ${smsProvider.name} threw:`, e);
    }
  }
}
