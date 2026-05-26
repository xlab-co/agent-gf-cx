/**
 * Hub — the agent.gf.cx landing.
 *
 * The umbrella surface for Dan's watch-list agents (speculative-opportunity
 * watchers — Mac mini refurb, UK flights, eBay sniffer, more to come). Each
 * agent surfaces as a compact card; live agents show their current state,
 * planned agents render as dashed-border placeholders so the hub feels
 * populated from day one.
 *
 * Single static HTML render, no JS framework. Card primitive comes from the
 * portfolio's shared cards.css at assets.gf.cx; hub-specific styling is
 * inline.
 */

import type { Env } from "./index";
import { MODULES, type ModuleEntry, type ModuleSummary } from "./modules";

interface ResolvedModule {
  entry: ModuleEntry;
  summary: ModuleSummary | null;
}

export async function renderHub(env: Env): Promise<string> {
  // Resolve live modules in parallel — keeps render-time bounded by the
  // slowest summary fetch, not the sum of them. Placeholders are O(0).
  const resolved: ResolvedModule[] = await Promise.all(
    MODULES.map(async (entry) => ({
      entry,
      summary: entry.summary ? await entry.summary(env) : null,
    })),
  );

  const liveCount = resolved.filter((r) => r.entry.status === "live").length;
  const plannedCount = resolved.filter((r) => r.entry.status === "planned").length;

  const cards = resolved.map(renderCard).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent.gf.cx · watch list</title>
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
    --card-grid-min: 240px;
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
            font-weight: 700; color: var(--ink-soft); margin-bottom: 18px; }
  .name { font-family: var(--serif); font-weight: 400; font-style: italic;
          font-size: 44px; line-height: 1.05; letter-spacing: -0.5px; margin-bottom: 10px; }
  .lede { font-size: 18px; color: var(--ink-soft); margin-bottom: 28px; max-width: 720px; }
  .meta { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 32px;
          letter-spacing: 0.3px; }
  .meta strong { color: var(--accent); font-weight: 700; }

  /* Hub card — compact tile, info-dense.
     Renders as <a class="card card--tile"> when live, <div> when planned. */
  a.card { color: inherit; text-decoration: none; }
  .card { padding: 16px 18px; display: flex; flex-direction: column; gap: 6px;
          min-height: 188px; transition: border-color .15s ease, transform .15s ease; }
  a.card:hover { border-color: var(--accent); transform: translateY(-1px);
                 box-shadow: 0 2px 8px rgba(26,24,22,0.06); }

  .card__kicker { font-size: 10.5px; letter-spacing: 1.1px; text-transform: uppercase;
                  color: var(--accent); font-weight: 700; }
  .card--placeholder .card__kicker { color: var(--ink-soft); }

  .card__name { font-family: var(--serif); font-size: 22px; line-height: 1.15;
                color: var(--ink); margin: 2px 0 6px; }
  .card__name em { font-style: italic; color: var(--accent); }

  .card__blurb { font-size: 13px; line-height: 1.5; color: var(--ink-soft);
                 margin: 0 0 10px; flex: 1; }

  .card__values { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
                  padding-top: 8px; border-top: 1px solid var(--line); }
  .card__latest { font-family: var(--serif); font-style: italic;
                  font-size: 26px; line-height: 1; color: var(--ink);
                  font-feature-settings: "tnum"; }
  .card__latest--below { color: var(--accent); font-weight: 600; }
  .card__latest--empty { font-size: 22px; color: var(--ink-soft); font-style: normal; }
  .card__target { font-size: 12px; color: var(--ink-soft); letter-spacing: 0.3px; }
  .card__target strong { color: var(--ink); font-weight: 700; }

  .card__sub { font-size: 12px; color: var(--ink-soft); margin-top: 4px;
               line-height: 1.4; }
  .card__sub em { font-style: italic; color: var(--accent); font-family: var(--serif); }

  .card__checked { font-size: 10.5px; letter-spacing: 0.4px; color: var(--ink-soft);
                   margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line);
                   text-transform: lowercase; }

  /* Planned placeholders — dashed border, lower opacity, no values panel */
  .card--placeholder {
    border-style: dashed;
    background: transparent;
    opacity: 0.78;
    cursor: default;
  }
  .card--placeholder .card__name { color: var(--ink-soft); }
  .card--placeholder .card__planned-pill {
    align-self: flex-start;
    font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase;
    font-weight: 700; color: var(--ink-soft);
    border: 1px solid var(--line-strong);
    padding: 3px 8px; border-radius: 3px;
    margin-top: 6px;
  }

  .foot { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--line);
          font-size: 13px; letter-spacing: 0.5px; color: var(--ink-soft);
          display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
</style>
</head>
<body>

<main class="page">

  <div class="kicker">agent.gf.cx · daily-cadence watch list</div>
  <h1 class="name"><em>Watch</em> list</h1>
  <p class="lede">Autonomous agents that watch the world while you sleep — each card is a thesis on a speculative opportunity (a deal, a fare, a listing) being checked once a day. When a thesis crosses its threshold, the agent pings.</p>
  <p class="meta"><strong>${liveCount}</strong> live · <strong>${plannedCount}</strong> planned · checked daily at 05:00 + 09:00 UTC</p>

  <div class="card-grid">
    ${cards}
  </div>

  <footer class="foot">
    <span>agent.gf.cx · umbrella for watch-list agents</span>
    <span>Add a module → src/modules.ts</span>
  </footer>

</main>

</body>
</html>`;
}

function renderCard(r: ResolvedModule): string {
  const { entry, summary } = r;

  if (entry.status === "planned") {
    return `<div class="card card--tile card--placeholder">
      <div class="card__kicker">${escape(entry.kicker)}</div>
      <h2 class="card__name">${escape(entry.name)}${entry.em ? ` <em>${escape(entry.em)}</em>` : ""}</h2>
      <p class="card__blurb">${escape(entry.blurb)}</p>
      <span class="card__planned-pill">Planned</span>
    </div>`;
  }

  // Live module — summary must be present
  const s = summary!;
  const latestClass =
    s.latest === "—"
      ? "card__latest card__latest--empty"
      : s.belowTarget
        ? "card__latest card__latest--below"
        : "card__latest";

  return `<a class="card card--tile" href="${escape(entry.detailPath)}">
    <div class="card__kicker">${escape(entry.kicker)}</div>
    <h2 class="card__name">${escape(entry.name)}${entry.em ? ` <em>${escape(entry.em)}</em>` : ""}</h2>
    <p class="card__blurb">${escape(entry.blurb)}</p>
    <div class="card__values">
      <span class="${latestClass}">${escape(s.latest)}</span>
      <span class="card__target">target <strong>${escape(s.target)}</strong></span>
    </div>
    <div class="card__sub">${escape(s.latestSub)}</div>
    <div class="card__checked">${escape(s.lastChecked)}</div>
  </a>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
