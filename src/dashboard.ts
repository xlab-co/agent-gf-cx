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
<title>Mac mini price watcher</title>
<style>
  :root {
    --bg: #f5f1e8;
    --ink: #1a1a1a;
    --muted: #6b6660;
    --line: #d8d3c8;
    --accent: #9F1C2E;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1a1a1a; --ink: #e8e2d4; --muted: #8a857d; --line: #3a3530; --accent: #D9667A; }
  }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--ink); margin: 0; padding: 40px 24px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 13px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
  h2 { font-family: Newsreader, Georgia, serif; font-style: italic; font-weight: 400; font-size: 36px; margin: 0 0 40px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 40px; padding: 24px; background: rgba(0,0,0,0.02); border-radius: 4px; }
  @media (prefers-color-scheme: dark) { .stats { background: rgba(255,255,255,0.03); } }
  .stat-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .stat-value { font-size: 24px; font-family: Newsreader, Georgia, serif; }
  .stat-value .accent { color: var(--accent); }
  .stat-sub { font-size: 12px; color: var(--muted); margin-top: 4px; font-family: Newsreader, Georgia, serif; font-style: italic; }
  .chart { margin-bottom: 40px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-weight: 500; color: var(--muted); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; padding: 12px 8px; border-bottom: 1px solid var(--line); }
  td { padding: 12px 8px; border-bottom: 1px solid var(--line); }
  td.price { font-feature-settings: "tnum"; }
  td.below { color: var(--accent); font-weight: 500; }
  .empty { color: var(--muted); font-style: italic; padding: 24px; text-align: center; }
  .intro { background: rgba(0,0,0,0.02); border-radius: 4px; padding: 24px 28px; margin-bottom: 32px; font-size: 14.5px; line-height: 1.65; }
  .intro p + p { margin-top: 12px; }
  .intro code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; padding: 1px 5px; background: rgba(0,0,0,0.04); border-radius: 3px; }
  @media (prefers-color-scheme: dark) {
    .intro { background: rgba(255,255,255,0.03); }
    .intro code { background: rgba(255,255,255,0.06); }
  }
  a { color: var(--ink); }
  footer { margin-top: 60px; padding-top: 24px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>agent.gf.cx · daily dashboards</h1>
  <h2>Mac mini watcher</h2>

  ${intro}

  <div class="stats">
    <div>
      <div class="stat-label">Latest</div>
      <div class="stat-value">${latest && latest.price !== null ? `$${latest.price.toFixed(2)}` : '—'}</div>
      <div class="stat-sub">${latest ? latest.source : 'no priced result yet'}</div>
    </div>
    <div>
      <div class="stat-label">All-time low</div>
      <div class="stat-value"><span class="${allTimeLow && (allTimeLow.cheapest!.price ?? Infinity) <= target.threshold ? 'accent' : ''}">${allTimeLow ? `$${allTimeLow.cheapest!.price!.toFixed(2)}` : '—'}</span></div>
      <div class="stat-sub">${allTimeLow ? formatDate(allTimeLow.timestamp) : 'awaiting first run'}</div>
    </div>
    <div>
      <div class="stat-label">Target</div>
      <div class="stat-value">$${target.threshold.toFixed(2)}</div>
      <div class="stat-sub">vs. $${target.retail.toFixed(2)} retail</div>
    </div>
  </div>

  ${chart}

  <table>
    <thead><tr><th>Date</th><th>Source</th><th style="text-align:right">Price</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <footer>
    Mac mini ${target.chip} ${target.ram}/${target.storage} · checked daily at 09:00 UTC<br>
    Alerts fire when cheapest source drops to or below $${target.threshold.toFixed(2)}
  </footer>
</div>
</body>
</html>`;
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
    return `<tr><td colspan="3" class="empty">No runs yet. The first cron fire at 09:00 UTC will populate this.</td></tr>`;
  }
  return entries
    .map((e) => {
      const date = formatDate(e.timestamp);
      const cheap = e.cheapest;
      if (!cheap || cheap.price === null) {
        return `<tr><td>${date}</td><td colspan="2" style="color:var(--muted);font-style:italic">no priced match</td></tr>`;
      }
      const below = cheap.price <= 1099 ? "below" : "";
      return `<tr><td>${date}</td><td><a href="${cheap.url}">${escapeHtml(cheap.source)}</a></td><td class="price ${below}" style="text-align:right">$${cheap.price.toFixed(2)}</td></tr>`;
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
