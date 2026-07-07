/**
 * deal-watcher — Cloudflare Worker
 * ---------------------------------------------------------------------------
 * CLAUDE.md / operator notes
 *
 * Watches eBay (Browse API) on a cron and alerts when a listing matches a
 * "want" (required/excluded title patterns + max price). Dedupes via KV so
 * each item alerts once. Same pattern as mac-mini-watcher.
 *
 * Bindings (wrangler.toml):
 *   [[kv_namespaces]] binding = "DEALS"
 *   [triggers] crons = ["*\/30 * * * *"]   # every 30 min
 *
 * Secrets (wrangler secret put ...):
 *   EBAY_CLIENT_ID        eBay app Client ID (production keyset)
 *   EBAY_CLIENT_SECRET    eBay app Client Secret
 *   RESEND_API_KEY        (optional) email alerts
 *   ALERT_EMAIL_TO        (optional) where alerts go
 *   ALERT_EMAIL_FROM      (optional) verified Resend sender
 *   SMSTO_API_KEY         (optional) SMS alerts via sms.to
 *   ALERT_SMS_TO          (optional) +1... destination number
 *
 * Edit WANTS below to change what it hunts for. No redeploy needed for price
 * tweaks if you later move WANTS into KV — for now it's inline.
 * ---------------------------------------------------------------------------
 */

const WANTS = [
  {
    id: "mac-studio-m1max-32-1tb",
    label: "Mac Studio M1 Max 32GB/1TB",
    query: "Apple Mac Studio M1 Max",
    require: [/m1\s*max/i, /\b32\s*gb/i, /\b1\s*tb\b/i],
    exclude: [/ultra/i, /\bfor parts\b/i, /\bbroken\b/i, /\bcase only\b/i],
    maxPrice: 900,
  },
  // Add more here, e.g. your planned M4 mini:
  // {
  //   id: "mac-mini-m4-24-1tb",
  //   label: "Mac mini M4 24GB/1TB",
  //   query: "Apple Mac mini M4",
  //   require: [/m4/i, /\b24\s*gb/i, /\b1\s*tb\b/i],
  //   exclude: [/pro\b/i, /for parts/i],
  //   maxPrice: 850,
  // },
];

const EBAY = {
  token: "https://api.ebay.com/identity/v1/oauth2/token",
  search: "https://api.ebay.com/buy/browse/v1/item_summary/search",
  scope: "https://api.ebay.com/oauth/api_scope",
  marketplace: "EBAY_US",
};

const SEEN_TTL = 60 * 60 * 24 * 30; // 30 days
const HITS_KEY = "hits"; // recent matches, for the dashboard
const HITS_MAX = 50;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      const found = await runScan(env);
      return json({ ran: true, newHits: found.length, hits: found });
    }
    return dashboard(env);
  },
};

async function runScan(env) {
  let token;
  try {
    token = await getEbayToken(env);
  } catch (e) {
    console.error("ebay token failed:", e.message);
    return [];
  }

  const newHits = [];

  for (const want of WANTS) {
    let items = [];
    try {
      items = await searchEbay(token, want);
    } catch (e) {
      console.error(`search failed for ${want.id}:`, e.message);
      continue;
    }

    for (const item of items) {
      const price = Number(item?.price?.value ?? Infinity);
      const title = item?.title ?? "";
      if (!matches(title, want)) continue;
      if (price > want.maxPrice) continue;

      const seenKey = `seen:${item.itemId}`;
      if (await env.DEALS.get(seenKey)) continue; // already alerted

      const hit = {
        wantId: want.id,
        wantLabel: want.label,
        itemId: item.itemId,
        title,
        price,
        currency: item?.price?.currency ?? "USD",
        url: item.itemWebUrl,
        condition: item.condition ?? "",
        seller: item?.seller?.username ?? "",
        location: item?.itemLocation?.country ?? "",
        foundAt: new Date().toISOString(),
      };

      await env.DEALS.put(seenKey, "1", { expirationTtl: SEEN_TTL });
      await recordHit(env, hit);
      await notify(env, hit);
      newHits.push(hit);
    }
  }

  return newHits;
}

function matches(title, want) {
  for (const re of want.require || []) if (!re.test(title)) return false;
  for (const re of want.exclude || []) if (re.test(title)) return false;
  return true;
}

async function getEbayToken(env) {
  const cached = await env.DEALS.get("ebay_token");
  if (cached) return cached;

  const basic = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: EBAY.scope,
  });

  const res = await fetch(EBAY.token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);

  const data = await res.json();
  // cache ~30s short of expiry
  const ttl = Math.max(60, (data.expires_in || 7200) - 30);
  await env.DEALS.put("ebay_token", data.access_token, { expirationTtl: ttl });
  return data.access_token;
}

async function searchEbay(token, want) {
  // Price-filter at the API to shrink payload; spec-match in code (titles vary).
  const filter = [
    `price:[..${want.maxPrice}]`,
    "priceCurrency:USD",
    "buyingOptions:{FIXED_PRICE}",
  ].join(",");

  const params = new URLSearchParams({
    q: want.query,
    filter,
    sort: "price", // cheapest first
    limit: "50",
  });

  const res = await fetch(`${EBAY.search}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": EBAY.marketplace,
    },
  });
  if (!res.ok) throw new Error(`search ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return data.itemSummaries || [];
}

async function recordHit(env, hit) {
  let hits = [];
  try {
    hits = JSON.parse((await env.DEALS.get(HITS_KEY)) || "[]");
  } catch {}
  hits.unshift(hit);
  hits = hits.slice(0, HITS_MAX);
  await env.DEALS.put(HITS_KEY, JSON.stringify(hits));
}

async function notify(env, hit) {
  const subject = `Deal: ${hit.wantLabel} — $${hit.price}`;
  const text =
    `${hit.title}\n$${hit.price} ${hit.currency} — ${hit.condition}\n` +
    `Seller: ${hit.seller} (${hit.location})\n${hit.url}`;

  if (env.RESEND_API_KEY && env.ALERT_EMAIL_TO && env.ALERT_EMAIL_FROM) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.ALERT_EMAIL_FROM,
          to: env.ALERT_EMAIL_TO,
          subject,
          text,
        }),
      });
    } catch (e) {
      console.error("email failed:", e.message);
    }
  }

  if (env.SMSTO_API_KEY && env.ALERT_SMS_TO) {
    try {
      await fetch("https://api.sms.to/sms/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SMSTO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: env.ALERT_SMS_TO,
          message: `${subject}\n${hit.url}`,
        }),
      });
    } catch (e) {
      console.error("sms failed:", e.message);
    }
  }
}

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

async function dashboard(env) {
  let hits = [];
  try {
    hits = JSON.parse((await env.DEALS.get(HITS_KEY)) || "[]");
  } catch {}

  const rows = hits
    .map(
      (h) => `<tr>
        <td>${escapeHtml(h.foundAt.slice(0, 16).replace("T", " "))}</td>
        <td>${escapeHtml(h.wantLabel)}</td>
        <td><a href="${escapeHtml(h.url)}">${escapeHtml(h.title)}</a></td>
        <td class="price">$${h.price}</td>
        <td>${escapeHtml(h.condition)}</td>
      </tr>`
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>deal-watcher</title>
<style>
  :root { --bg:#f5f1e8; --ink:#1a1a1a; --crimson:#9F1C2E; }
  body { background:var(--bg); color:var(--ink); font-family:Helvetica,Arial,sans-serif; margin:0; padding:2rem; }
  h1 { font-size:1.25rem; letter-spacing:-0.01em; }
  .meta { color:#6b6b6b; font-size:0.85rem; margin-bottom:1.5rem; }
  table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  th,td { text-align:left; padding:0.5rem 0.75rem; border-bottom:1px solid #e2dcce; }
  th { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:#6b6b6b; }
  a { color:var(--ink); }
  .price { color:var(--crimson); font-weight:bold; white-space:nowrap; }
  .empty { color:#6b6b6b; font-style:italic; }
</style></head><body>
  <h1>deal-watcher</h1>
  <div class="meta">${hits.length} recent match${hits.length === 1 ? "" : "es"} · <a href="/run">run now</a></div>
  ${
    hits.length
      ? `<table><thead><tr><th>Found</th><th>Want</th><th>Listing</th><th>Price</th><th>Condition</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="empty">No matches yet. The cron will populate this.</p>`
  }
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
