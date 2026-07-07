/**
 * Dashboard — a single static HTML page showing the price history.
 * Inline SVG chart, no JS frameworks, no external dependencies.
 * Aesthetic deliberately echoes dare.co.uk: Helvetica + Newsreader italic,
 * crimson accent on the threshold line.
 */

interface HistoryEntry {
  timestamp: string;
  cheapest: { source: string; name: string; price: number | null; url: string } | null;
}

interface Target {
  chip: string;
  ram: string;
  storage: string;
  retail: number;
  threshold: number;
}

// Apple Direct buy-now link for the watched config (M4 24GB/1TB, SKU
// MCYT4LL/A). Carries our affid for click attribution. Update if Apple
// rotates the SKU or campaign codes. Pickup-note is time-sensitive
// (varies by zip + stock); keep as a captured-at-link-add hint, not
// a live truth.
const RETAIL_BUY_LINK =
  "https://www.apple.com/shop/buy-mac/mac-mini/m4-chip-10-core-cpu-10-core-gpu-24gb-memory-1tb-storage" +
  "?afid=p240%7Cbi~cmp-698273627~adg-1243549019723441~ad-77721948949861_pla-2329521542558113" +
  "~dev-c~ext-~prd-MCYT4LL%2FA~nt-search~crid-2329521542558113" +
  "&cid=aos-us-kwbi-pmax-mac---product-MCYT4LL%2FA";
const RETAIL_PICKUP_NOTE = "in-stock · pickup Wed Aug 26 (link-add 26 May 2026)";

export function renderDashboard(history: HistoryEntry[], target: Target): string {
  const priced = history.filter(
    (h) => h.cheapest && h.cheapest.price !== null,
  );

  const latest = priced.at(-1)?.cheapest ?? null;
  const allTimeLow = priced.length
    ? priced.reduce((a, b) =>
        (a.cheapest!.price ?? Infinity) < (b.cheapest!.price ?? Infinity) ? a : b,
      )
    : null;

  const chart = renderChart(priced, target);
  const rows = renderRows(history.slice(-30).reverse());

  // Empty-state framing — visible until the first run lands history.
  // Doubles as the "what is agent.gf.cx" landing for early visits.
  const intro = history.length === 0
    ? `<div class="intro">
         <p><strong>agent.gf.cx</strong> is the canopy for autonomous daily-cadence
         modules that watch the world while you sleep. Each module checks a thing
         once a day, stores history, and pings you when the thing is worth your
         attention.</p>
         <p><em>Module #1</em> &mdash; this page &mdash; watches Apple Refurbished
         for a Mac mini ${target.chip} ${target.ram}/${target.storage} priced at
         or below <strong>$${target.threshold.toFixed(0)}</strong>. The first
         scheduled run fires at 09:00 UTC; the chart and ledger below will
         populate from there. <code>/api/test-alert</code> forces the notification
         path for end-to-end testing without waiting for cron.</p>
       </div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent.gf.cx · Mac mini watcher</title>
<meta property="og:title" content="agent.gf.cx">
<meta property="og:description" content="Autonomous-agent watch list · gf.cx portfolio">
<meta property="og:type" content="website">
<meta property="og:image" content="https://media.gf.cx/agent.gf.cx/og/card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://media.gf.cx/agent.gf.cx/og/card.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://assets.gf.cx/cards/cards.css">
<style>
  :root {
    --bg: #f7f3ec; --bg-warm: #ebe3d5;
    --bg-card: rgba(255, 255, 255, 0.55);
    --ink: #1a1816; --ink-soft: #5a544d; --accent: #2c4a3a;
    --line: rgba(26, 24, 22, 0.12); --line-strong: rgba(26, 24, 22, 0.32);
    --sans: 'Atkinson Hyperlegible', Verdana, Tahoma, -apple-system, BlinkMacSystemFont, sans-serif;
    --serif: 'Newsreader', 'Times New Roman', Georgia, serif;
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font-family: var(--sans);
         font-size: 17px; line-height: 1.55; -webkit-font-smoothing: antialiased; margin: 0; }
  em { font-family: var(--serif); font-style: italic; color: var(--accent); font-weight: 400; }
  a { color: inherit; text-decoration: underline; text-underline-offset: 3px;
      text-decoration-color: var(--line-strong); }
  a:hover { color: var(--accent); text-decoration-color: var(--accent); }
  .page { max-width: 1100px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
  .kicker { font-size: 13px; letter-spacing: 1.4px; text-transform: uppercase;
            font-weight: 700; color: var(--ink-soft); margin-bottom: 24px; }
  .name { font-family: var(--serif); font-weight: 400; font-style: italic;
          font-size: 44px; line-height: 1.05; letter-spacing: -0.5px; margin-bottom: 8px; }
  .lede { font-size: 19px; color: var(--ink-soft); margin-bottom: 32px; max-width: 760px; }
  .intro { background: var(--bg-card); border: 1px solid var(--line-strong); border-radius: 8px;
           padding: 22px 26px; margin-bottom: 32px; font-size: 15.5px; line-height: 1.65; }
  .intro p + p { margin-top: 10px; }
  .intro code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px;
                padding: 1px 5px; background: rgba(0,0,0,0.04); border-radius: 3px; }
  .accent { color: var(--accent); }

  /* Verdict-first hierarchy — the single number is the page. */
  .verdict { margin: 56px 0 40px; text-align: center; }
  .verdict__price { font-family: var(--serif); font-weight: 500; font-size: 96px;
                    line-height: 1; letter-spacing: -2px; color: var(--ink);
                    font-feature-settings: "tnum"; font-style: normal; }
  .verdict__price.is-below { color: var(--accent); }
  .verdict__waiting { font-family: var(--serif); font-style: italic;
                      font-weight: 400; font-size: 48px; line-height: 1.1;
                      letter-spacing: -0.5px; color: var(--ink-soft); }
  .verdict__delta { margin-top: 18px; font-size: 17px; color: var(--ink-soft);
                    letter-spacing: 0.2px; }
  .verdict__delta.is-below { color: var(--accent); font-weight: 700;
                             letter-spacing: 1.2px; text-transform: uppercase; font-size: 14px; }
  .verdict__delta.is-empty { font-family: var(--serif); font-style: italic; font-size: 18px; }
  .verdict__rule { border: 0; border-top: 1px solid var(--line-strong);
                   width: 56px; margin: 28px auto; opacity: 0.6; }
  .verdict__context { font-size: 14px; color: var(--ink-soft);
                      letter-spacing: 0.3px; }
  .verdict__context strong { color: var(--ink); font-weight: 700;
                             font-feature-settings: "tnum"; margin-left: 4px; }
  .verdict__context .sep { margin: 0 12px; color: var(--line-strong); }
  .verdict__context .accent strong { color: var(--accent); }

  @media (max-width: 600px) {
    .verdict__price { font-size: 64px; letter-spacing: -1px; }
    .verdict__waiting { font-size: 34px; }
    .verdict__context { font-size: 13px; }
    .verdict__context .sep { margin: 0 6px; }
  }

  /* Retail anchor — "what costs today, now, at Apple Direct." Sits
     under the verdict so the refurb result has its baseline-of-truth
     on the same screen. Tappable, prefetchy hover, but quieter than
     the verdict price itself. */
  .retail-cta { display: inline-flex; align-items: baseline; gap: 12px;
                margin: -8px auto 32px; padding: 12px 18px;
                background: var(--bg-card); border: 1px solid var(--line-strong);
                border-radius: 8px; text-decoration: none; color: var(--ink);
                font-size: 15px; transition: border-color .15s, background .15s; }
  .retail-cta:hover { border-color: var(--accent);
                      background: rgba(255, 255, 255, 0.85);
                      color: var(--accent); text-decoration: none; }
  .retail-cta__label { font-size: 11px; letter-spacing: 1.1px;
                       text-transform: uppercase; font-weight: 700;
                       color: var(--ink-soft); }
  .retail-cta:hover .retail-cta__label { color: var(--accent); }
  .retail-cta__price { font-family: var(--serif); font-style: italic;
                       font-size: 22px; line-height: 1;
                       font-feature-settings: "tnum"; }
  .retail-cta__sub { font-size: 12px; color: var(--ink-soft);
                     letter-spacing: 0.3px; }
  .retail-cta__wrap { display: flex; justify-content: center;
                      margin: -8px 0 32px; }
  @media (max-width: 500px) {
    .retail-cta { flex-wrap: wrap; gap: 4px 12px; }
    .retail-cta__sub { flex-basis: 100%; }
  }

  .chart { margin: 36px 0; }
  .ledger-heading { font-size: 12px; letter-spacing: 1.4px; text-transform: uppercase;
                    font-weight: 700; color: var(--ink-soft); margin: 28px 0 14px; }
  .ledger .card--tile .card__count { font-feature-settings: "tnum"; }
  .ledger .card--tile .card__title { font-family: var(--serif); font-style: italic;
                                      font-size: 24px; line-height: 1.05; font-feature-settings: "tnum"; }
  .ledger .card--tile .card__title.below { color: var(--accent); }
  .ledger .card--tile .card__title.no-match { font-style: normal; font-size: 14px;
                                               font-family: var(--sans); color: var(--ink-soft); }
  .ledger .card--tile .card__meta a { text-decoration-color: var(--line); }
  .empty { color: var(--ink-soft); font-style: italic; padding: 24px; text-align: center;
           border: 1px dashed var(--line-strong); border-radius: 6px; }
  .empty em { color: var(--accent); }
  .foot { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--line);
          font-size: 13px; letter-spacing: 0.5px; color: var(--ink-soft);
          display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
</style>
</head>
<body>

<main class="page">

  <div class="kicker">agent.gf.cx · daily dashboards</div>
  <h1 class="name">Mac mini <em>watcher</em></h1>
  <p class="lede">Apple Refurbished, checked twice daily — alerts when a Mac mini ${target.chip} ${target.ram}/${target.storage} drops to or below $${target.threshold.toFixed(0)}.</p>

  ${intro}

  ${renderVerdict(latest, allTimeLow, target)}

  <div class="retail-cta__wrap">
    <a class="retail-cta" href="${RETAIL_BUY_LINK}" target="_blank" rel="noopener">
      <span class="retail-cta__label">Buy retail now</span>
      <span class="retail-cta__price">$${target.retail.toFixed(0)}</span>
      <span class="retail-cta__sub">Apple Direct · ${RETAIL_PICKUP_NOTE}</span>
    </a>
  </div>

  ${chart}

  <div class="ledger-heading">Recent checks · last 30</div>
  <div class="card-grid card-grid--narrow ledger">
    ${rows}
  </div>

  <footer class="foot">
    <span>Mac mini ${target.chip} ${target.ram}/${target.storage} · checked 05:00 + 09:00 UTC daily</span>
    <span>Alerts ≤ $${target.threshold.toFixed(2)}</span>
  </footer>

</main>

</body>
</html>`;
}

function renderVerdict(
  latest: HistoryEntry["cheapest"] | null,
  allTimeLow: HistoryEntry | null,
  target: Target,
): string {
  const fmt2 = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  const price = latest && latest.price !== null ? latest.price : null;
  const lowPrice =
    allTimeLow && allTimeLow.cheapest && allTimeLow.cheapest.price !== null
      ? allTimeLow.cheapest.price
      : null;

  // The hero number + the delta line.
  let priceHtml: string;
  let deltaHtml: string;

  if (price === null) {
    // Empty state: skip the dash entirely (em-dash glyph is just a horizontal
    // line and dies at any font-size). Make the message itself the hero.
    priceHtml = `<div class="verdict__waiting">first check pending</div>`;
    deltaHtml = "";
  } else if (price <= target.threshold) {
    const under = fmt0(target.threshold - price);
    priceHtml = `<div class="verdict__price is-below">$${fmt2(price)}</div>`;
    deltaHtml =
      price === target.threshold
        ? `<div class="verdict__delta is-below">at target</div>`
        : `<div class="verdict__delta is-below">↓ $${under} below target</div>`;
  } else {
    const over = fmt0(price - target.threshold);
    priceHtml = `<div class="verdict__price">$${fmt2(price)}</div>`;
    deltaHtml = `<div class="verdict__delta">↑ $${over} above target</div>`;
  }

  // Context strip: target · retail · all-time low
  const lowBelow = lowPrice !== null && lowPrice <= target.threshold;
  const lowFragment =
    lowPrice !== null
      ? `<span${lowBelow ? ' class="accent"' : ""}>all-time low<strong>$${fmt0(lowPrice)}</strong></span>`
      : `<span>all-time low<strong>—</strong></span>`;

  return `<section class="verdict" aria-label="Current verdict">
    ${priceHtml}
    ${deltaHtml}
    <hr class="verdict__rule">
    <div class="verdict__context">
      <span>target<strong>$${fmt0(target.threshold)}</strong></span>
      <span class="sep">·</span>
      <span>retail<strong>$${fmt0(target.retail)}</strong></span>
      <span class="sep">·</span>
      ${lowFragment}
    </div>
  </section>`;
}

function renderChart(priced: HistoryEntry[], target: Target): string {
  if (priced.length < 2) {
    return `<div class="empty">Chart appears once there are at least two data points.</div>`;
  }

  const width = 712;
  const height = 220;
  const padL = 50, padR = 16, padT = 16, padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const prices = priced.map((p) => p.cheapest!.price!);
  const minP = Math.min(...prices, target.threshold) - 20;
  const maxP = Math.max(...prices, target.retail) + 20;

  const x = (i: number) => padL + (i / (priced.length - 1)) * plotW;
  const y = (p: number) => padT + plotH - ((p - minP) / (maxP - minP)) * plotH;

  const path = priced
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.cheapest!.price!).toFixed(1)}`)
    .join(" ");

  const dots = priced
    .map((p, i) => {
      const px = p.cheapest!.price!;
      const cy = y(px);
      const cx = x(i);
      const fill = px <= target.threshold ? "var(--accent)" : "var(--ink)";
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="${fill}"/>`;
    })
    .join("");

  const yAxis = [minP, (minP + maxP) / 2, maxP]
    .map(
      (v) =>
        `<text x="${padL - 8}" y="${y(v).toFixed(1) + 4}" font-size="10" fill="var(--muted)" text-anchor="end" font-family="-apple-system, Helvetica">$${v.toFixed(0)}</text>`,
    )
    .join("");

  const thresholdY = y(target.threshold).toFixed(1);
  const retailY = y(target.retail).toFixed(1);

  return `
<div class="chart">
<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
  <line x1="${padL}" y1="${retailY}" x2="${width - padR}" y2="${retailY}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2,4"/>
  <text x="${width - padR}" y="${parseFloat(retailY) - 4}" font-size="10" fill="var(--muted)" text-anchor="end" font-family="-apple-system, Helvetica">retail $${target.retail.toFixed(0)}</text>
  <line x1="${padL}" y1="${thresholdY}" x2="${width - padR}" y2="${thresholdY}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2,4" opacity="0.5"/>
  <text x="${width - padR}" y="${parseFloat(thresholdY) - 4}" font-size="10" fill="var(--accent)" text-anchor="end" font-family="-apple-system, Helvetica">target $${target.threshold.toFixed(0)}</text>
  ${yAxis}
  <path d="${path}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round"/>
  ${dots}
</svg>
</div>`;
}

function renderRows(entries: HistoryEntry[]): string {
  if (!entries.length) {
    return `<div class="empty" style="grid-column: 1 / -1">No runs yet. The first cron fire at 09:00 UTC will populate this.</div>`;
  }
  return entries
    .map((e) => {
      const date = formatDate(e.timestamp);
      const cheap = e.cheapest;
      if (!cheap || cheap.price === null) {
        return `<div class="card card--tile card--placeholder">
          <p class="card__count">${date}</p>
          <p class="card__title no-match">no priced match</p>
          <p class="card__meta">&mdash;</p>
        </div>`;
      }
      const belowClass = cheap.price <= 1099 ? " below" : "";
      return `<div class="card card--tile">
        <p class="card__count">${date}</p>
        <p class="card__title${belowClass}">$${cheap.price.toFixed(2)}</p>
        <p class="card__meta"><a href="${cheap.url}">${escapeHtml(cheap.source)}</a></p>
      </div>`;
    })
    .join("");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
