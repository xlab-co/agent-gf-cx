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

  const allTimeLowBelow =
    allTimeLow && (allTimeLow.cheapest!.price ?? Infinity) <= target.threshold;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent.gf.cx · Mac mini watcher</title>
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
  .chart { margin: 36px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; margin-top: 20px; }
  th { text-align: left; font-weight: 700; color: var(--ink-soft); font-size: 12px;
       letter-spacing: 1.2px; text-transform: uppercase; padding: 12px 8px;
       border-bottom: 1px solid var(--line-strong); }
  td { padding: 12px 8px; border-bottom: 1px solid var(--line); }
  td.price { font-feature-settings: "tnum"; }
  td.below { color: var(--accent); font-weight: 700; }
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

  <div class="card-grid card-grid--narrow">
    <div class="card card--stat">
      <div class="card__label">Latest</div>
      <div class="card__value">${latest && latest.price !== null ? `$${latest.price.toFixed(2)}` : '—'}</div>
      <div class="card__sub">${latest ? latest.source : 'no priced result yet'}</div>
    </div>
    <div class="card card--stat">
      <div class="card__label">All-time low</div>
      <div class="card__value"><span class="${allTimeLowBelow ? 'accent' : ''}">${allTimeLow ? `$${allTimeLow.cheapest!.price!.toFixed(2)}` : '—'}</span></div>
      <div class="card__sub">${allTimeLow ? formatDate(allTimeLow.timestamp) : 'awaiting first run'}</div>
    </div>
    <div class="card card--stat">
      <div class="card__label">Target</div>
      <div class="card__value">$${target.threshold.toFixed(2)}</div>
      <div class="card__sub">vs. $${target.retail.toFixed(2)} retail</div>
    </div>
  </div>

  ${chart}

  <table>
    <thead><tr><th>Date</th><th>Source</th><th style="text-align:right">Price</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <footer class="foot">
    <span>Mac mini ${target.chip} ${target.ram}/${target.storage} · checked 05:00 + 09:00 UTC daily</span>
    <span>Alerts ≤ $${target.threshold.toFixed(2)}</span>
  </footer>

</main>

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
