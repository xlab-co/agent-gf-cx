# agent.gf.cx · operator notes

Cloudflare Worker that hosts the **agent.gf.cx daily dashboard** — an umbrella
for autonomous-agent modules that watch the world while Dan sleeps.

**Module #1 (this Worker):** Mac mini M4 24GB/1TB price watcher.
Scans Apple Refurbished daily, stores history in KV, alerts via webhook +
Resend email when prices cross a threshold. Dashboard at `agent.gf.cx/`.

Future modules (status-watchers, stock-watchers, asset-monitors) will land
either as additional routes in this Worker or as siblings mounted at the same
agent.gf.cx domain.

This file exists so Claude Code has context whenever you SSH in or work in
this repo. Read it first.

## Layout

- `src/index.ts` — entrypoint. `fetch` handles HTTP, `scheduled` handles cron.
- `src/sources.ts` — scrapers. Currently only Apple Refurbished. Each source
  is a function returning `PriceResult[]`. Add new ones here and call them
  from `runCheck` in `index.ts`.
- `src/dashboard.ts` — pure-function HTML renderer for the `/` dashboard.
  No JS framework, inline SVG chart, styled to echo dare.co.uk aesthetic.
- `wrangler.toml` — bindings, cron, secrets reference. Worker name
  `agent-gfcx`; custom domain `agent.gf.cx`.

## First-time deploy — scoped token path (canonical)

This repo uses the `wrangler-deploy` wrapper + 1Password-stored scoped token,
matching the rest of the portfolio. The `.wrangler-deploy` file at the repo
root carries the op:// reference; the wrapper injects `CLOUDFLARE_API_TOKEN`
into wrangler's environment for the invocation only.

**1.** Mint the deploy token at https://dash.cloudflare.com/profile/api-tokens
(Custom Token). Spec per `~/bin/mint-cf-token-spec.md` section 2, plus KV
Storage + DNS Edit:

| Scope   | Permission             | Access |
|---------|------------------------|--------|
| Account | Workers Scripts        | Edit   |
| Account | Workers KV Storage     | Edit   |
| Account | Account Settings       | Read   |
| Zone    | Workers Routes         | Edit   |
| Zone    | DNS                    | Edit   |
| User    | User Details           | Read   |
| User    | Memberships            | Read   |

- Account Resources → Include → cine@gf.cx's account
- Zone Resources → Include → All zones from account
- TTL blank · Client IP filter blank

**2.** Save to 1Password:
- Item title: `Cloudflare agent-gfcx deploy`
- Vault: `Private`
- One CONCEALED field labeled `credential` (matching the op:// path in `.wrangler-deploy`)

**3.** Verify:

```bash
~/bin/verify-cf-token.sh "op://Private/Cloudflare agent-gfcx deploy/credential"
# expect: 200
```

**4.** Deploy (the wrapper reads `.wrangler-deploy` automatically):

```bash
cd ~/Code/agent.gf.cx

# Already done: npm install

# Create the KV namespace
wrangler-deploy kv namespace create HISTORY
# Paste the returned `id = "..."` into wrangler.toml,
# replacing REPLACE_WITH_KV_ID_FROM_WRANGLER

# Set secrets (skip channels you don't want)
wrangler-deploy secret put WEBHOOK_URL          # Zapier/ntfy.sh/Slack catch URL
wrangler-deploy secret put RESEND_API_KEY       # Bearer token from resend.com dashboard
wrangler-deploy secret put RESEND_FROM          # e.g. agent@gf.cx (must be a verified Resend domain)
wrangler-deploy secret put RESEND_TO            # e.g. dan@gf.cx
wrangler-deploy secret put TWILIO_ACCOUNT_SID   # from 1Password Twilio item
wrangler-deploy secret put TWILIO_AUTH_TOKEN
wrangler-deploy secret put TWILIO_FROM          # e.g. +12155551234
wrangler-deploy secret put TWILIO_TO            # e.g. +12155556789

# Deploy
wrangler-deploy deploy

# Force a test run (via the *.workers.dev URL before custom-domain is bound)
curl https://agent-gfcx.<your-cf-subdomain>.workers.dev/api/test-alert
```

## Fallback: `wrangler login` OAuth

If the scoped-token path isn't an option (e.g. token minting blocked, account
exploration), the OAuth flow still works:

```bash
npx wrangler login                    # opens browser, authorizes account-wide
npx wrangler whoami                   # confirm account
# ...then use `npx wrangler <cmd>` instead of `wrangler-deploy <cmd>`
```

If OAuth fails with `(ref: ...)`:

```bash
rm -rf ~/.wrangler/config ~/.config/.wrangler
npx wrangler login
```

## After deploy: custom domain + Access

1. Cloudflare dashboard → Workers & Pages → **agent-gfcx** → Settings → Triggers
2. Add Custom Domain: **`agent.gf.cx`**
3. Zero Trust → Access → Applications → Add an Application → Self-hosted
   - Application domain: `agent.gf.cx`
   - Identity providers: One-time PIN (or your existing Google/email setup)
   - Policy: `Include — Emails — dan@gf.cx`
   - Session duration: 30 days (per memory `user_cf_access_session_30day_default.md`)
4. Test by hitting `https://agent.gf.cx` in incognito — should challenge for
   email verification before showing the dashboard.

After binding, run `~/bin/gfcx_dns_unstick.sh agent.gf.cx` to flush
NextDNS — per memory `feedback_pre_flight_ping_poisons_nextdns_cache.md`.

## Resend domain-verification setup

Email goes through Resend (resend.com). Free tier covers 100 emails/day,
which is 100× our cadence. Before Resend will accept sends from
`agent@gf.cx`, the gf.cx domain must be verified in their dashboard:

1. Sign up at resend.com (free, no credit card)
2. Domains → Add Domain → `gf.cx` → US region (or EU)
3. Resend will show 3 DNS records to add — a return-path MX, an SPF TXT,
   and a DKIM TXT. Add them to the gf.cx zone (I can run them via
   `cf-api --token-ref "op://Code Shared/Cloudflare agent-gfcx deploy/credential"`
   once Dan shares the values from Resend's UI)
4. Click Verify in Resend's dashboard — usually <2 min after DNS propagates
5. API Keys → Create → scope to `Sending access` only → copy the `re_...` value
6. `wrangler-deploy secret put RESEND_API_KEY` (paste the `re_...` value)

**Don't use MailChannels** — their free Workers integration was sunset in
mid-2024 and now returns 401 to new Workers. See memory
`feedback_mailchannels_workers_free_tier_dead_2026-05-26.md` for context.
Any `_mailchannels.gf.cx` lockdown or `relay.mailchannels.net` SPF include
on the zone is now dead weight that can be removed in a hygiene pass.

## Tuning the Mac mini target

Edit `TARGET` in `src/index.ts`:

```ts
const TARGET = {
  chip: "M4",         // "M4", "M4 Pro", etc.
  ram: "24GB",
  storage: "1TB",
  retail: 1199.0,     // direct configurator price
  threshold: 1099.0,  // alert when ≤ this
};
```

The Apple Refurbished scraper filters product titles case-insensitively on
all three of chip/ram/storage strings. Watch for Apple's naming
inconsistencies — sometimes they write "1 TB" with a space.

## When the scraper breaks

Apple changes their refurbished page HTML occasionally. Signs of breakage:
- The history table shows "no priced match" for 5+ consecutive days
- The `/api/check` endpoint returns an empty `Apple Refurbished` result while
  the page (in a browser) clearly shows Mac minis

To fix:

```bash
curl -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  https://www.apple.com/shop/refurbished/mac/mac-mini > /tmp/refurb.html
grep -A 20 "Mac mini" /tmp/refurb.html | head -50
# Update TILE_PATTERN in src/sources.ts; redeploy.
npx wrangler deploy
```

## Adding a second module

Two patterns:

**Inline (recommended while modules are few):** add a new scraper to
`src/sources.ts`, wire it into a new path in `src/index.ts` (e.g.
`/mac-mini/`, `/imac/`, `/<thing>/`), and split the dashboard.

**Sibling Worker:** spin a new repo at `~/Code/agent.gf.cx-<module>/` with
its own `wrangler.toml`, mount it at `agent.gf.cx/<module>/*` via a route.
Use this when modules have different cron cadences or upstream contracts.

## Adding price sources to this module

Pattern in `src/sources.ts`:

```ts
export async function checkBHPhoto(target: Target): Promise<PriceResult[]> {
  const resp = await fetch("https://www.bhphotovideo.com/...");
  // parse, filter on target, return PriceResult[]
}
```

Then call it in `runCheck` in `index.ts`. Each source is independent — one
breaking doesn't stop the others.

## Cost

Well within Cloudflare's free tier (per `user_saas_spend_discipline_claude_max.md`):
- 100,000 Worker requests/day · we use ~1 cron + a few manual
- 1,000 KV reads/day · ~1 cron + dashboard loads
- 10ms CPU per request · well under
- Resend free tier (100/day, 3000/month) covers our cadence with ~100× headroom
- No egress

Expect $0/month.

## Endpoints

- `GET /` — dashboard (HTML, behind Access)
- `GET /api/history` — JSON of all stored runs
- `GET /api/check` — run check now, return result, do NOT store
- `GET /api/test-alert` — fire the alert path with current price (for testing)

## Local development

```bash
npm run dev              # local server on :8787
npm run test-cron        # trigger scheduled() locally
npm run tail             # stream production logs
```
