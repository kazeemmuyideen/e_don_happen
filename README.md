# E don happen

A location-aware community incident reporting application for Lagos. Residents publish observations, confirm or dispute nearby reports, manage alert subscriptions, and receive in-app and optional browser push notifications. Moderators review reports and record reasons for decisions. The backend domain is named **Neighbourhood Signal**.

## Project status

The integrated application is a functional development prototype, not a production release. The behavior and configuration sections here and in the development guide describe the current working tree. The guide's source-symbol appendix still links to [historical snapshot `09db39d`](https://github.com/johdanike/group_9b/tree/09db39de1b8b761a369135badbb0802e9f730f99) on `demo/pitch-integration`; those links are archival, not a description of current code. This documentation can be merged independently; its presence on `main` does not imply that the integrated runtime has been merged there.

Implemented: WhatsApp or SMS OTP with backend-canonical phone normalization, JWT sessions, persistent geospatial reports with NIPOST postcode validation, independent community votes, moderator review and appeals, contributor history badges, category/radius subscriptions, inbox notifications, scanned image evidence with local/S3 storage, communities and responders, SOS fan-out with acknowledgement and in-app escalation, optional best-effort emergency SMS dispatch, incident grouping/verification, subscription billing with payment capture, analytics summaries, a health endpoint, fail-closed production startup validation, security headers, request IDs, Redis-backed rate limiting, and an installable PWA with opt-in Web Push. Console OTP, demo payments, passthrough scanning, and disabled external dispatch are development/test paths; production startup rejects the demo and insecure settings.

## Technology

| Layer | Stack |
| --- | --- |
| Web application | React 19, React Router 7, Vite 8, Tailwind CSS 4 |
| API | NestJS 12, TypeScript 6, Passport/JWT, class-validator |
| Persistence | PostgreSQL 15 with PostGIS, TypeORM |
| Infrastructure | Redis 7, Docker Compose, optional Cloudflare temporary tunnel |
| PWA | vite-plugin-pwa, Workbox, service worker, encrypted Web Push/VAPID |
| Validation | Vitest, Node.js HTTP integration tests, Oxlint, TypeScript typecheck, npm audit, TypeORM migration verification |

## Getting started

Use Node.js 24, npm 11, Git, and Docker Desktop with Linux containers. Run commands from the repository root. On Windows, use `npm.cmd` if PowerShell execution policy blocks `npm`.

```sh
git switch demo/pitch-integration
npm ci
```

Copy `backend/.env.example` to `backend/.env` without overwriting existing settings (`Copy-Item backend/.env.example backend/.env` in PowerShell, or `cp backend/.env.example backend/.env` on macOS/Linux).

```sh
npm run db:up
npm run build
npm run demo:seed
npm run dev
```

Open the application at http://127.0.0.1:5173 and API documentation at http://127.0.0.1:3000/api/docs. Vite forwards `/api` to the backend on port 3000. Local PostgreSQL uses port 55432 and Redis uses 56379. `npm run db:down` stops containers while retaining database volumes.

OTP delivery uses `OTP_DELIVERY_DRIVER` (falling back to `WHATSAPP_DRIVER`): `whatsapp` uses the Meta WhatsApp Cloud API with an approved authentication template, `sms` posts to the configured `SMS_API_URL`, and `console` is demo-only. Set the selected provider's credentials plus `WHATSAPP_OTP_SECRET`; production startup rejects console delivery, placeholder secrets, and insecure CORS/proxy settings. Local demo uses `WHATSAPP_DRIVER=console`: request a code in the application and read it on the host from `backend/.local/demo-otps.json`. The private mailbox must never be committed or served publicly. Backend canonicalization converts 11-digit Nigerian numbers starting with `0` to `+234` and accepts formatted international numbers. The seed provides fictional accounts `+2348000000001` through `+2348000000004`; the fourth is a moderator. Sample reports are illustrative.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start backend and frontend development processes |
| `npm run build` | Compile backend and build the PWA |
| `npm test` | Run backend unit tests |
| `npm run test:e2e` | Run HTTP integration tests using its own API process and the configured demo database |
| `npm run health` | Probe `GET /api/health` (override with `HEALTH_URL`) and exit non-zero when unhealthy |
| `npm run lint --workspace backend` | Run type-aware backend linting |
| `npm run demo:seed` | Add guarded, idempotent sample data after building |
| `npm run demo:serve` | Serve built frontend and proxy the API on port 4173 |
| `npm run demo:share` | Start an optional temporary public HTTPS tunnel |

Backend-only scripts `typeorm`, `migration:generate`, `migration:run`, `migration:revert`, and `migration:show` use `backend/src/config/typeorm.datasource.ts`. The initial migration installs `postgis`/`uuid-ossp` and creates all current tables; `DEMO_MODE` schema synchronization is development-only.

## Mobile and PWA access

For a built application, run the compiled backend (`npm run start:prod --workspace backend`) and `npm run demo:serve` in separate terminals after `npm run build`. `start:prod` names the compiled entry point; it does not set `NODE_ENV`. Set `NODE_ENV=production` explicitly to activate startup validation and disable Swagger by default.

Install `cloudflared` or set `CLOUDFLARED_PATH` to its executable, then run `npm run demo:share`. Open the printed HTTPS URL on the phone. The host computer and processes must remain running. A new tunnel URL is a new browser origin and requires a new installation/subscription. Plain HTTP on a LAN generally cannot provide PWA installation or Web Push; `localhost` on a phone refers to the phone itself.

Enable notifications through the application's explicit permission button. On supported iPhones/iPads, install through Safari's Add to Home Screen and launch the installed app before enabling push. The PWA caches its shell, not report data or offline writes. Provider acceptance does not prove notification display.

## Repository layout

```text
backend/src/       Nest modules, entities, DTOs, guards, services, seed
frontend/src/      Pages, shared components, API/session/push helpers, service worker
frontend/public/   Icons and static assets
scripts/           Development launcher, integration suite, static/API proxy, tunnel
init-scripts/      Fresh-database PostGIS initialization
docs/              Development and implementation reference
```

## Development and deployment

Read [the development guide](docs/DEVELOPMENT.md) for setup, architecture, current configuration, API routes, data models, workflows, tests, troubleshooting, and production prerequisites; its source-symbol appendix is a pinned historical snapshot. CI runs build, lint, backend typecheck, unit and e2e tests, a production-dependency audit, and migration verification against a fresh database.

Keep changes focused and reviewable. Run the checks relevant to a change, document API/configuration changes, and submit a pull request. Never commit `.env`, backend `.local` data, private notes, VAPID private keys, access tokens, or real personal data. Use synthetic fixtures when testing.

Production requires a stable HTTPS origin, managed secrets, `NODE_ENV=production` with passing startup validation, reviewed migrations, backups, and operational monitoring. Demo schema synchronization, console OTPs, demo payments, passthrough scanning, and disabled external dispatch are development/test defaults; startup rejects the unsafe ones. Swagger is off in production unless `SWAGGER_ENABLED=true`. See the guide's release checklist before deploying.

## License

No open-source license has been granted. The backend package is marked `UNLICENSED`; obtain the repository owner's permission for redistribution or reuse.
