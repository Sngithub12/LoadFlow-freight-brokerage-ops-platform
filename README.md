# LoadFlow — Freight Brokerage Operations Suite

A hackathon build of an ops platform for a freight brokerage: post loads, assign
compliant carriers, confirm versioned rates, and track a shipment
Posted → Carrier Assigned → Rate Confirmed → Dispatched → In Transit →
Delivered → POD Verified → Invoiced/Closed, with a real (not hardcoded) RBAC
system across Broker, Carrier, and Shipper accounts.

## Stack, and why

**Node.js + Express, `node:sqlite`, JWT auth (`jsonwebtoken`), password
hashing (`bcryptjs`).** One-line reason: this is the conventional,
recognizable shape of a Node backend — routing, auth, and password storage
all use the same libraries most Node teams reach for, rather than hand-rolled
equivalents, so the codebase reads like a normal production service instead
of a bespoke framework.

The one deliberate exception is the database layer: `node:sqlite`
(`DatabaseSync`) is Node's own built-in, available since Node 22.5, used
instead of a database package so there's no native module to compile on
whatever machine runs this. Everything else — `express`, `jsonwebtoken`,
`bcryptjs`, `dotenv` — is a normal `npm install`.

The frontend is a single vanilla-JS SPA (hash routing, no build step) so
there's nothing to compile there either — `npm install` covers the backend,
and the frontend just needs the server running to be served as static files.

## Run it

Requires Node.js ≥ 22.5 (built-in `node:sqlite`).

```bash
git clone <your-repo-url>
cd loadflow

npm install      # express, jsonwebtoken, bcryptjs, dotenv

# optional: copy .env.example -> .env and set JWT_SECRET.
# PORT and SESSION_TTL_HOURS have working defaults either way; JWT_SECRET
# falls back to a dev-only value with a startup warning if you skip this.
cp .env.example .env

npm run seed     # bootstraps orgs, admins, roles, staff, and 3 demo loads
npm start        # http://localhost:3000
```

The `data/` directory (SQLite file + permission-denied log) is created on
first run and is git-ignored. Delete `data/loadflow.db` and re-run
`npm run seed` to reset to a clean demo state.

### Configuration

Everything configurable lives in `server/config.js`, sourced from
environment variables via `.env` (loaded with `dotenv`), with defaults for
everything except the signing secret:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `SESSION_TTL_HOURS` | `12` | How long a login JWT stays valid |
| `JWT_SECRET` | dev fallback (with a startup warning) | Signs/verifies login tokens — set a real one before deploying anywhere real |

**No third-party API keys are required.** `JWT_SECRET` is a local signing
secret, not a credential for an external service — LoadFlow doesn't call
any third-party API today. If that changes (e.g. adding real email
delivery for staff invites, see "With more time" below), that's one more
variable read in `server/config.js`, not scattered through route files.

### Deploying it somewhere with a public URL

This is an Express app with a file-based SQLite database, so it runs on
anything that gives you a persistent filesystem: a small VPS,
Render/Railway/Fly.io (Node buildpack, `npm install` then `npm start`), or a
spare machine on your LAN. Set `JWT_SECRET` in the host's environment
variables before going live — don't ship the repo's `.env.example` default.
The only other thing to check on a host with an ephemeral/read-only
filesystem is that `data/` is writable (or mounted as a persistent volume) —
that's where the SQLite file and the permission-denied log live.

### Submitting this as a repo

```bash
git init
git add -A
git commit -m "Initial commit"
git remote add origin git@github.com:<you>/loadflow.git
git push -u origin main
```

## Demo accounts

| Role | Email | Password | Notes |
|---|---|---|---|
| Broker Admin | admin@meridianfreight.com | admin123 | full permissions, manages staff/roles |
| Broker · Dispatcher role | dispatcher@meridianfreight.com | dispatch123 | `load.assign_carrier`, `rate.confirm` only |
| Broker · Ops Lead role | opslead@meridianfreight.com | opslead123 | above + `load.create`, `load.override_compliance_flag`, `load.update_status` |
| Carrier Admin (compliant) | admin@swifttrucking.com | admin123 | Swift Trucking Co — clean compliance record |
| Carrier · Driver role | driver@swifttrucking.com | driver123 | `load.update_status`, `pod.upload` only |
| Carrier Admin (non-compliant) | admin@bluelinelogistics.com | admin123 | Blue Line Logistics — **expired insurance**, demonstrates auto-flagging |
| Shipper | shipper@globalretail.com | shipper123 | read-only, own loads only |

Seed data includes three loads across the pipeline (`LF-1001` Posted,
`LF-1002` Rate Confirmed, `LF-1003` Carrier Assigned + auto-flagged) so the
state machine and compliance gate are visible immediately without manual
setup.

## RBAC design

- **Permission catalog is fixed** (`server/permissions.js`): `load.create`,
  `load.assign_carrier`, `load.override_compliance_flag`, `rate.confirm`,
  `load.update_status`, `staff.manage`, `pod.upload`. Every request handler
  checks a permission *key*, never a role name — see
  `server/middleware.js:requirePermission()`.
- **Roles are org-scoped bundles** of that catalog, created through the UI
  (Staff & Roles page) and stored in `roles` / `role_permissions`. An Admin
  implicitly holds every permission valid for their org type; nothing else
  is hardcoded per-role.
- **Bootstrap**: there's no public sign-up. The *first* Admin of a Broker or
  Carrier org is provisioned directly in `server/seed.js` — the same way a
  real deployment's onboarding team would create the org record. Every
  account after that is created in-app by that Admin via
  `POST /api/org/staff` (the real "invite" flow — there's no email
  delivery in this build, so the Admin is handed a temp password to relay
  out of band).
- **Org scoping is independent of permissions**: a Broker's `load.create`
  permission only ever lets them create loads under *their* `broker_org_id`;
  a Carrier can never see another carrier's loads regardless of their role.
  This is enforced in `server/routes/loads.js:canAccessLoad()`, applied on
  every read and write, not just in the UI.
- **API-layer enforcement**: every mutating route runs
  `requireAuth → requireAccountType → requirePermission → (object-scope
  check inside the handler)` before touching the database. Hitting an
  endpoint directly with `curl` and a lower-privileged token is blocked the
  same as clicking a hidden button would be — verified in this build by
  `curl`-only smoke tests, no UI involved (see "How I used AI tooling"
  below).
- **Denials are logged** to both console and `data/permission_denied.log`
  (`server/middleware.js:logDenied`), including the endpoint, the missing
  permission, and who attempted it.

## Data model notes

- **Rate confirmations are versioned** (`rate_confirmations`, one row per
  version, `is_current` flag). Confirming a new rate never mutates history —
  it inserts `version + 1` and flips the old row's `is_current` off, so a
  load that was re-negotiated still shows what was actually confirmed at
  dispatch time.
- **Compliance auto-flagging** (`server/compliance.js:evaluateCompliance`)
  runs at carrier-assignment time and again whenever a carrier's compliance
  record changes (so a load that was fine yesterday gets flagged today if
  their insurance lapses). It checks authority status, insurance expiry,
  and equipment/commodity approval against the load's requirements. A flag
  blocks progression past "Carrier Assigned" until it's resolved or
  overridden with a mandatory, audit-logged justification note.
- **Every status change is audited** (`load_audit`): from-status, to-status,
  action, actor, timestamp, optional note. The load detail page renders
  this directly; there's also an org-wide audit log viewer (stretch goal).

## What's incomplete / simplified

- **POD upload is a filename stub**, not real file storage — there's no
  multipart handling or binary storage layer. It transitions the load and
  records who/when, but there's nothing to actually download.
- **No email delivery.** Staff invites depend on it for a real "invite
  link" flow; instead, invites surface a temp password directly in the UI.
  Compliance renewal alerts (see below) don't need email — they're
  in-app — but a production version would likely also email whoever's
  responsible when a carrier crosses into the warning window, not just
  show it next time someone opens the app.
- **No automated test suite.** Verification was manual: `node --check` on
  every file, a `curl`-driven integration pass exercising the full load
  lifecycle + RBAC denials + cross-org scoping (see below), and Playwright
  screenshots of each screen. Given more time this would become a real
  Node `test` runner suite.
- **`node:sqlite` is still an experimental Node API.** Fine for a
  single-process hackathon demo; a production version would swap in a
  stable driver (or Postgres) without touching the query code much, since
  everything goes through prepared statements in one `db.js` module.
- **Logout is client-side only.** Auth uses stateless JWTs — there's no
  server-side session store to revoke, so "logout" just means the browser
  discards the token; a token issued before logout stays technically valid
  until it expires (`SESSION_TTL_HOURS`, 12h by default). A token blocklist
  or short-lived-access + refresh-token pair would close that gap — noted
  in `server/auth.js:destroySession` as exactly where it'd go.
- **No pagination** on the load board or audit log (audit log is capped at
  200 rows server-side as a stopgap).

## With more time, next

1. Real file storage for POD (and rate-confirmation PDFs), with signed
   download URLs.
2. Email-based invite + password-reset flow, and email delivery for
   compliance renewal alerts (the alerting logic itself already exists —
   `server/compliance.js:classifyExpiry` — this would just add a delivery
   channel beyond "shows up when someone opens the app").
3. Automated tests (unit tests for `evaluateCompliance`/`classifyExpiry`
   and the state machine transitions, integration tests for the RBAC
   matrix).
4. Optimistic UI + polling or SSE so a carrier's status update shows up on
   the broker's board without a manual refresh.
5. Rate negotiation as a back-and-forth thread rather than a single
   broker-confirms action, since real accessorial negotiation is rarely
   one-shot.

## How I used AI tooling

Built with Claude as the AI coding tool, in layers, verifying each layer
before building on it rather than writing the whole app and debugging at
the end:

1. Schema + permission catalog + auth/session primitives first, committed
   once they existed on disk.
2. Route layer (org/staff/roles, loads/state-machine, compliance,
   audit) on top of that, then a `curl`-scripted integration pass in the
   same session — login as each seeded account, assert 200s on allowed
   actions and 403/409s on disallowed ones (wrong permission, wrong org,
   wrong state), confirm the audit trail and permission-denied log
   recorded what actually happened. Bugs caught this way: a carrier org ID
   collision in a manual test (caught immediately, not a code bug), and
   the ladder needing viewer-relative party names, which was fixed by
   hydrating `broker_org_name` / `carrier_org_name` / `shipper_name` /
   `other_party_name` server-side once the frontend needed it rather than
   pushing that join logic into the client.
3. Frontend last, against the already-verified API — then Playwright
   screenshots of the login screen, dashboard, and load detail to review
   the actual rendered layout, which caught a CSS spacing bug in the
   pipeline-stage labels (first label column was sized to fit the node dot
   rather than the text, so "Posted" crowded into "Carrier Assigned") that
   would've been easy to miss from code review alone.

Commit history is left intact (`git log`) and follows this same layering:
scaffold → backend → frontend, rather than one squashed commit.
