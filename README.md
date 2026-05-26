# agent.gf.cx

A canopy for daily-cadence Cloudflare-Worker modules that watch the world
while you sleep. Each module runs a cron, stores history in Workers KV,
and pings the operator via webhook + email + SMS when the thing it
watches crosses a threshold.

**Module #1 (this Worker):** Mac mini M4 24GB/1TB price watcher. Scrapes
Apple Refurbished daily; alerts when the price drops to or below $1,099.

## Quick links

- Live dashboard (Cloudflare-Access-gated): <https://agent.gf.cx/>
- Operator notes: [`CLAUDE.md`](./CLAUDE.md)
- Worker name: `agent-gf-cx` · custom domain: `agent.gf.cx`
- License: [MIT](./LICENSE)

## What's inside

- `src/index.ts` — entrypoint (HTTP + cron handlers)
- `src/sources.ts` — Apple Refurbished scraper (HTMLRewriter)
- `src/sms.ts` — provider abstraction for SMS (sms.to and Twilio)
- `src/dashboard.ts` — HTML dashboard renderer (no JS framework, inline SVG chart)
- `wrangler.toml` — bindings, cron trigger
- `CLAUDE.md` — deploy + operator runbook

## Deploy

See [`CLAUDE.md`](./CLAUDE.md) for the full deploy walkthrough. The short version:

```bash
npm install
# token-based auth (recommended): drop a `.wrangler-deploy` file with op:// reference
wrangler-deploy deploy
# or oauth:
npx wrangler login && npx wrangler deploy
```

Notification channels are independent secrets — set whichever subset you want:

```bash
wrangler secret put WEBHOOK_URL           # Zapier / ntfy / Slack
wrangler secret put RESEND_API_KEY        # Resend email (100/day free)
wrangler secret put RESEND_FROM           # verified sender, e.g. agent@yourdomain
wrangler secret put RESEND_TO
wrangler secret put SMSTO_API_KEY         # sms.to Bearer token
wrangler secret put SMSTO_TO              # recipient, E.164
# or Twilio (TWILIO_ACCOUNT_SID + AUTH_TOKEN + FROM + TO)
```

## Architecture

```
cron (daily 09:00 UTC)
  → scrape Apple Refurbished
  → diff vs threshold
  → store in KV
  → if alert: webhook + Resend email + sms.to SMS
  → dashboard at / renders chart + ledger
```

## Adding a source

Each scraper is a function in `src/sources.ts` returning `Promise<PriceResult[]>`.
The notification, history, and alert plumbing handle whatever sources you add.

## Contributing

This is a sandbox project under [xlab-co](https://github.com/xlab-co).
Issues and pull requests welcome — particularly for additional source
adapters or notification provider adapters.

---

Built by [Dan Sellars](https://github.com/xlab-co) · MIT licensed
