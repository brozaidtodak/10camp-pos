# POS10C

Custom Point of Sale system for [10 CAMP](https://10camp.com), built to replace EasyStore POS with a leaner, in-house alternative tailored to the shop's workflow.

## Live

- App: <https://www.10camp.com> (alias of <https://pos-system-test.netlify.app>)
- Demo login: PIN `8888` (Tester account, External Demo mode — safe for walkthroughs)

## What it does

A web-based POS that runs in any modern browser and installs as a PWA on tablets and phones. It handles the full retail loop end-to-end:

- **Cashier** — cart, split payment, walk-in quick checkout, customer-facing display, receipt print
- **Inventory** — products, variants, batches, stock-take, low-stock alerts, purchase orders
- **Customers** — registry with phone-deduped profiles, B2B accounts, loyalty points
- **Finance** — daily sales, refunds, expenses, P&L, cash drawer reconciliation
- **HR / Roster** — staff list, shift schedule, attendance
- **Marketing** — campaigns, promo codes, bundle pricing
- **Intelligence** — sales dashboards, anomaly alerts, "Tanya 10 CAMP" AI assistant (Claude-powered)
- **Channel sync** — two-way EasyStore integration (POS sale pushes to EasyStore; online orders webhook back into POS and deduct stock)

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (no framework) |
| Styling | Custom design tokens, namespaced per feature |
| Backend | Supabase (Postgres + Auth + Storage) |
| Serverless | Netlify Functions (Node) |
| AI | Anthropic Claude API (via `claude-ask` function) |
| Hosting | Netlify (auto-deploy on push to `main`) |
| PWA | Manifest + service worker for offline-capable install |

## Mode system

The app exposes four roles, each with its own landing page and visible sidebar groups:

- **Cashier** — cart + checkout only
- **Operasi** — cashier + inventory + roster
- **Pengurus** — operasi + finance + reports + customer / B2B
- **Investor** — read-only finance dashboards

Per-staff overrides are stored in `localStorage` under `staffModeAccess_v1`. Login is PIN-only with auto-detection via `__detectUserByPin`.

## Local setup

```bash
git clone https://github.com/brozaidtodak/Pos-System-Test.git
cd Pos-System-Test
npm install
```

Create a `.env` file in the project root:

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role>   # for sync scripts only
EASYSTORE_TOKEN=<easystore-api-token>      # for channel sync
ANTHROPIC_API_KEY=<claude-key>             # for Tanya 10 CAMP
```

Run with Netlify CLI so the serverless functions resolve:

```bash
netlify dev
```

Open <http://localhost:8888>.

## File structure

```
.
├── index.html              # Single-page app shell (~9k lines)
├── app.js                  # All client logic (~12k lines)
├── design-tokens.css       # Feature-namespaced CSS (lp-, pdb-, fin-, inv-, cp-, …)
├── style.css               # Base typography, login, sidebar, cart, print
├── customer-display.html   # Second-screen view for customer-facing display
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── netlify.toml            # Build + function routing
├── netlify/functions/
│   ├── claude-ask.js       # Tanya 10 CAMP AI proxy
│   ├── easystore-push.js   # POS sale → EasyStore variant qty decrement
│   └── easystore-webhook.js# EasyStore order events → sales_history + batch deduction
├── scripts/
│   ├── easystore_sync.py
│   └── easystore_webhook_register.py
├── docs/
│   └── EASYSTORE_SYNC_SETUP.md
└── assets/brand/           # Logos, product photos, web-ready PNG/JPG
```

## Deploy

Push to `main` — Netlify builds and deploys automatically. The publish directory is the repo root; functions are bundled with esbuild from `netlify/functions/`.

## Roadmap

| Phase | Theme | Status |
|---|---|---|
| 1 | Stabilize | Shipped (36/36) |
| 2 | Compliance MY (LHDN, e-wallet) | Mostly done — blocked on external credentials |
| 3 | Channels (i18n, public API, mobile) | In progress |
| 4 | Operations | Shipped (12/12) |
| 5 | Vertical (Retail focus) | In progress |
| 6 | Multi-branch | Deferred until 2nd outlet opens |
| 7 | Growth & Loyalty | Shipped (10/10) |
| 8 | Intelligence | In progress |

## Credits

Built by Zaid ([@brozaidtodak](https://github.com/brozaidtodak)) for 10 CAMP, with engineering assistance from Claude Code.
