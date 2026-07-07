/**
 * ebay-sniffer — Cloudflare Worker (agent.gf.cx · served on io.gf.cx/agent/ebay)
 * ---------------------------------------------------------------------------
 * The first agent on the agent.gf.cx surface. Two faces, one Worker:
 *
 *   1. PUBLIC FACE
 *      GET  /agent/ebay            holding page (styled, og:image card)
 *      GET  /agent/ebay/           "
 *      GET  /agent/ebay/dashboard  recent deal finds (table)
 *      GET  /agent/ebay/status.json  normalised status card (status.gf.cx)
 *      GET  /agent/ebay/run        manual scan trigger (returns JSON)
 *
 *   2. COMPLIANCE ENDPOINT (eBay Marketplace Account Deletion)
 *      GET  /agent/ebay/account-deletion?challenge_code=XYZ
 *           -> 200 {"challengeResponse": sha256(code + token + endpoint)}
 *      POST /agent/ebay/account-deletion -> 200 (we store no eBay PII)
 *
 *   3. THE AGENT (cron)
 *      scheduled()  every 30 min → Browse API search per WANT → dedup in KV →
 *                   Pushover one-liner on a fresh match.
 *
 * Bindings (wrangler.toml):
 *   [[kv_namespaces]] binding = "DEALS"
 *   [triggers] crons = ["*\/30 * * * *"]
 *
 * Secrets (wrangler secret put ...):
 *   EBAY_CLIENT_ID      eBay production App ID (client id)
 *   EBAY_CLIENT_SECRET  eBay production Cert ID (client secret)
 *   PUSHOVER_TOKEN      Pushover application token   (optional → alerts off)
 *   PUSHOVER_USER       Pushover user/group key      (optional → alerts off)
 *
 * Edit WANTS to change what it hunts. Marketplace is UK (EBAY_GB / GBP).
 * ---------------------------------------------------------------------------
 */

// ── eBay account-deletion compliance ───────────────────────────────────────
// Must match the "Verification token" entered in eBay's portal. Low-sensitivity
// (only proves endpoint ownership in combination with the URL).
const VERIFICATION_TOKEN = "sb3qQdHdNUhwHsSng-K7A8DW4oru5OYUuX87wQ_0TAc8YTrF";

const BASE = "/agent/ebay";
const DELETION_PATH = `${BASE}/account-deletion`;

// ── What the agent hunts ────────────────────────────────────────────────────
const WANTS = [
  {
    id: "mac-studio-m1max-32-1tb",
    label: "Mac Studio M1 Max 32GB/1TB",
    query: "Apple Mac Studio M1 Max",
    require: [/m1\s*max/i, /\b32\s*gb/i, /\b1\s*tb\b/i],
    exclude: [/ultra/i, /\bfor parts\b/i, /\bbroken\b/i, /\bcase only\b/i, /\bfaulty\b/i],
    maxPrice: 900, // GBP
  },
  // Add more here, e.g. the planned M4 mini:
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
  marketplace: "EBAY_GB", // Dan is UK
  currency: "GBP",
};

const SEEN_TTL = 60 * 60 * 24 * 30; // 30 days
const HITS_KEY = "hits";
const HITS_MAX = 50;
const STATUS_KEY = "status"; // last-scan summary for the status card
const CURR = "£";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── compliance endpoint ────────────────────────────────────────────────
    if (path === DELETION_PATH || path === DELETION_PATH + "/") {
      if (request.method === "GET") {
        const code = url.searchParams.get("challenge_code");
        if (!code) {
          return jsonResp({ error: "missing challenge_code" }, 400);
        }
        const endpoint = url.origin + url.pathname; // exact registered URL, no query
        const buf = new TextEncoder().encode(code + VERIFICATION_TOKEN + endpoint);
        const digest = await crypto.subtle.digest("SHA-256", buf);
        const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
        return jsonResp({ challengeResponse: hex }, 200);
      }
      if (request.method === "POST") return new Response(null, { status: 200 });
      return new Response("method not allowed", { status: 405 });
    }

    // ── agent faces ────────────────────────────────────────────────────────
    if (path === `${BASE}/run`) {
      const found = await runScan(env);
      return jsonResp({ ran: true, newHits: found.length, hits: found }, 200);
    }
    if (path === `${BASE}/status.json`) {
      return jsonResp(await buildStatus(env), 200);
    }
    if (path === `${BASE}/dashboard` || path === `${BASE}/dashboard/`) {
      return dashboard(env);
    }

    // ── holding page (root + any stray sub-path) ───────────────────────────
    return new Response(HOLDING_HTML, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Short edge cache; revalidate so a redeploy isn't masked by stale HTML.
        "cache-control": "public, max-age=60, must-revalidate",
      },
    });
  },
};

// ── scan ────────────────────────────────────────────────────────────────────
async function runScan(env) {
  const newHits = [];
  let error = null;
  let token;
  try {
    token = await getEbayToken(env);
  } catch (e) {
    console.error("ebay token failed:", e.message);
    await writeStatus(env, { error: `token: ${e.message}`, newHits: 0 });
    return [];
  }

  for (const want of WANTS) {
    let items = [];
    try {
      items = await searchEbay(token, want);
    } catch (e) {
      console.error(`search failed for ${want.id}:`, e.message);
      error = e.message;
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
        maxPrice: want.maxPrice,
        itemId: item.itemId,
        title,
        price,
        currency: item?.price?.currency ?? EBAY.currency,
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

  await writeStatus(env, { error, newHits: newHits.length });
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
  const body = new URLSearchParams({ grant_type: "client_credentials", scope: EBAY.scope });

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
  const ttl = Math.max(60, (data.expires_in || 7200) - 30);
  await env.DEALS.put("ebay_token", data.access_token, { expirationTtl: ttl });
  return data.access_token;
}

async function searchEbay(token, want) {
  const filter = [
    `price:[..${want.maxPrice}]`,
    `priceCurrency:${EBAY.currency}`,
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

// ── notify: portfolio messaging-as-a-service — a contextual one-liner ───────
// Worker is edge → can't shell notify.py; hit Pushover directly (Pushover is
// the shipping provider behind ~/bin/notify.py). The VALUE is the sentence.
async function notify(env, hit) {
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) return;
  const headroom = Math.round(hit.maxPrice - hit.price);
  const cond = hit.condition ? ` (${hit.condition})` : "";
  const sentence =
    `${hit.wantLabel} — ${CURR}${hit.price}${cond}` +
    (headroom > 0 ? `, ${CURR}${headroom} under your ${CURR}${hit.maxPrice} ceiling` : "");

  try {
    await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: env.PUSHOVER_TOKEN,
        user: env.PUSHOVER_USER,
        title: "eBay deal-watcher",
        message: sentence,
        url: hit.url,
        url_title: "View listing on eBay",
        priority: "0",
      }),
    });
  } catch (e) {
    console.error("pushover failed:", e.message);
  }
}

// ── status card (status.gf.cx pulls this URL) ───────────────────────────────
async function writeStatus(env, { error, newHits }) {
  const prev = await readStatus(env);
  const status = {
    lastScan: new Date().toISOString(),
    lastError: error || null,
    lastNewHits: newHits,
    totalHits: prev.totalHits ? prev.totalHits + newHits : newHits,
  };
  await env.DEALS.put(STATUS_KEY, JSON.stringify(status));
}

async function readStatus(env) {
  try {
    return JSON.parse((await env.DEALS.get(STATUS_KEY)) || "{}");
  } catch {
    return {};
  }
}

async function buildStatus(env) {
  const s = await readStatus(env);
  let hits = [];
  try {
    hits = JSON.parse((await env.DEALS.get(HITS_KEY)) || "[]");
  } catch {}

  const wantCount = WANTS.length;
  let verdict = "green";
  let summary;
  if (s.lastError) {
    verdict = "red";
    summary = `Last scan errored: ${s.lastError}`;
  } else if (!s.lastScan) {
    verdict = "yellow";
    summary = `Watching ${wantCount} want${wantCount === 1 ? "" : "s"} · no scan yet`;
  } else {
    // Stale if the last scan is older than ~70 min (2 missed 30-min crons).
    const ageMin = (Date.now() - new Date(s.lastScan).getTime()) / 60000;
    if (ageMin > 70) {
      verdict = "yellow";
      summary = `Watching ${wantCount} want${wantCount === 1 ? "" : "s"} · last scan ${Math.round(ageMin)}m ago (stale)`;
    } else {
      summary =
        `Watching ${wantCount} want${wantCount === 1 ? "" : "s"} · ${hits.length} recent find${hits.length === 1 ? "" : "s"}` +
        (hits.length ? ` · cheapest ${CURR}${hits[0].price}` : "");
    }
  }

  return {
    slug: "ebay-sniffer",
    surface: "agent.gf.cx",
    title: "ebay-sniffer · eBay deal-watcher",
    verdict,
    summary,
    updated: s.lastScan || null,
    metrics: {
      wants: wantCount,
      recentFinds: hits.length,
      lastNewHits: s.lastNewHits ?? 0,
      lastError: s.lastError || null,
    },
    link: "https://io.gf.cx/agent/ebay/dashboard",
  };
}

// ── dashboard ───────────────────────────────────────────────────────────────
async function dashboard(env) {
  let hits = [];
  try {
    hits = JSON.parse((await env.DEALS.get(HITS_KEY)) || "[]");
  } catch {}
  const s = await readStatus(env);

  const rows = hits
    .map(
      (h) => `<tr>
        <td>${escapeHtml(h.foundAt.slice(0, 16).replace("T", " "))}</td>
        <td>${escapeHtml(h.wantLabel)}</td>
        <td><a href="${escapeHtml(h.url)}" target="_blank" rel="noopener">${escapeHtml(h.title)}</a></td>
        <td class="price">${CURR}${h.price}</td>
        <td>${escapeHtml(h.condition)}</td>
      </tr>`
    )
    .join("");

  const last = s.lastScan ? `${escapeHtml(s.lastScan.slice(0, 16).replace("T", " "))} UTC` : "never";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ebay-sniffer · finds</title>
<style>
  :root { color-scheme: dark; --bg:#0d0e12; --ink:#e7e7ea; --crimson:#e58a8f; --muted:#7e828c; }
  body { background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; margin:0; padding:2rem;
         background-image: radial-gradient(60rem 40rem at 70% -10%, rgba(184,38,46,0.14), transparent 60%); }
  a.back { color:var(--muted); text-decoration:none; font-size:.8rem; }
  h1 { font-size:1.4rem; letter-spacing:-0.02em; margin:.6rem 0 .2rem; }
  .meta { color:var(--muted); font-size:0.85rem; margin-bottom:1.5rem; }
  .meta a { color:var(--muted); }
  table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  th,td { text-align:left; padding:0.55rem 0.75rem; border-bottom:1px solid #23252c; }
  th { font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted); }
  a { color:var(--ink); }
  .price { color:var(--crimson); font-weight:700; white-space:nowrap; }
  .empty { color:var(--muted); font-style:italic; }
</style></head><body>
  <a class="back" href="${BASE}/">← ebay-sniffer</a>
  <h1>recent finds</h1>
  <div class="meta">${hits.length} match${hits.length === 1 ? "" : "es"} · last scan ${last} · <a href="${BASE}/run">run now</a></div>
  ${
    hits.length
      ? `<table><thead><tr><th>Found (UTC)</th><th>Want</th><th>Listing</th><th>Price</th><th>Condition</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="empty">No matches yet. The cron populates this every 30 min.</p>`
  }
</body></html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=30, must-revalidate",
    },
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────
function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    // Dynamic — never let the edge serve a stale status card / challenge.
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── holding page ─────────────────────────────────────────────────────────────
const OG_IMAGE = "https://media.gf.cx/agent/og/ebay-sniffer.png";

const HOLDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ebay-sniffer · agent.gf.cx</title>
<meta name="description" content="ebay-sniffer — an autonomous eBay deal-watcher on the agent.gf.cx surface. Polls for target listings and notifies on good deals.">
<meta property="og:type" content="website">
<meta property="og:title" content="ebay-sniffer · agent.gf.cx">
<meta property="og:description" content="An autonomous eBay deal-watcher on the agent.gf.cx surface.">
<meta property="og:url" content="https://io.gf.cx/agent/ebay/">
<meta property="og:image" content="${OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #e7e7ea; background: #0d0e12;
    background-image: radial-gradient(60rem 40rem at 70% -10%, rgba(184,38,46,0.16), transparent 60%);
    padding: 2rem;
  }
  .card { max-width: 34rem; }
  .eyebrow {
    font-size: .72rem; letter-spacing: .14em; text-transform: uppercase;
    color: #9aa0aa; margin: 0 0 .9rem;
  }
  h1 {
    font-size: clamp(2rem, 6vw, 3rem); margin: 0 0 .4rem; font-weight: 700;
    letter-spacing: -.02em;
  }
  h1 .dot { color: #b8262e; }
  .tag {
    display: inline-flex; align-items: center; gap: .5rem; margin: 0 0 1.6rem;
    font-size: .8rem;
    background: rgba(184,38,46,0.10); border: 1px solid rgba(184,38,46,0.32);
    color: #e58a8f; border-radius: 999px; padding: .3rem .8rem;
  }
  .tag .led {
    width: .5rem; height: .5rem; border-radius: 50%; background: #2ecc71;
    box-shadow: 0 0 .5rem #2ecc71;
  }
  p { margin: 0 0 1rem; color: #b9bdc6; }
  .links { margin-top: 1.6rem; display: flex; gap: 1.2rem; font-size: .9rem; }
  .links a { color: #e58a8f; text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  .meta { font-size: .82rem; color: #7e828c; margin-top: 1.8rem; }
  .meta a { color: #9aa0aa; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #c9cdd4; }
</style>
</head>
<body>
  <main class="card">
    <p class="eyebrow">agent.gf.cx</p>
    <h1>ebay-sniffer<span class="dot">.</span></h1>
    <span class="tag"><span class="led"></span> live · standing by</span>
    <p>An autonomous eBay deal-watcher. It polls for target listings every 30
       minutes and pings me when a good deal appears — the first agent on the
       <strong>agent.gf.cx</strong> surface.</p>
    <p>Headless service; its eBay Marketplace Account Deletion compliance
       endpoint lives at <code>/agent/ebay/account-deletion</code>.</p>
    <div class="links">
      <a href="/agent/ebay/dashboard">recent finds →</a>
      <a href="/agent/ebay/status.json">status →</a>
    </div>
    <p class="meta">gf.cx · <a href="https://gf.cx">portfolio</a></p>
  </main>
</body>
</html>`;
