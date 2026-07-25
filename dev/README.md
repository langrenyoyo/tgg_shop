# TGG Shop Dev

This directory contains the runnable development MVP for TGG Shop. It is intended for requirement validation, UI flow testing, backend rule verification, and handoff into production engineering.

## Current Stage

- Status: runnable MVP / development prototype.
- User app: product browsing, pure-points exchange, cart, checkout, membership, orders, order detail, refund request, ledgers, ranking, profile flows.
- Admin app: dashboard, orders, state machine diagnostics, product and pure-points management, users, pickup sites, delivery teams, task review, finance, ledgers, permissions, exceptions, settings.
- Backend: Node.js HTTP server, modular routes/services/repositories, JSON and SQLite development storage, OpenAPI contract, migration checks, unit tests, and smoke tests.
- Verified locally on `http://127.0.0.1:5177`.

## Structure

```text
dev/
|-- backend/
|   |-- database/migrations/
|   |-- scripts/
|   |-- src/
|   |   |-- data/
|   |   |-- domain/
|   |   |-- http/
|   |   |-- repositories/
|   |   |-- routes/
|   |   `-- services/
|   |-- test/
|   |-- openapi.yaml
|   |-- package.json
|   `-- server.js
|-- frontend/
|   |-- admin/
|   |   |-- js/
|   |   |-- index.html
|   |   `-- styles.css
|   `-- user/
|       |-- js/
|       |-- index.html
|       `-- styles.css
`-- README.md
```

## Run

```bash
cd dev/backend
npm run dev
```

Open:

- User app: `http://127.0.0.1:5177/user?skipSplash=1`
- Admin app: `http://127.0.0.1:5177/admin`
- Health check: `http://127.0.0.1:5177/api/health`

## Test

```bash
cd dev/backend
npm test
```

Current validation layers:

- Migration coverage check.
- OpenAPI route coverage check.
- Unit tests for order rules, refund rules, exceptions, fulfillment, task callbacks, and permissions.
- Smoke tests for JSON storage.
- Smoke tests for SQLite storage.

Useful narrow checks:

```bash
cd dev/backend
npm run db:check
npm run api:check
npm run test:unit
node --check ..\frontend\user\js\app.js
node --check ..\frontend\user\js\render.js
node --check ..\frontend\admin\js\app.js
node --check ..\frontend\admin\js\render.js
```

## Authentication

The MVP uses signed Bearer tokens for user and admin requests. Login creates a persisted session, refresh tokens rotate access tokens, logout revokes the current session, and repeated failed login attempts temporarily lock the account. The local demo password defaults to `123456` and can be changed with `TGG_DEMO_PASSWORD` or `TGG_DEMO_PASSWORD_HASH`.

```text
POST /api/auth/login
{ "userId": "u_1001", "password": "123456" }

POST /api/admin/auth/login
{ "roleId": "super_admin", "password": "123456" }

Authorization: Bearer <token>

POST /api/auth/logout
POST /api/auth/refresh
POST /api/admin/auth/logout
POST /api/admin/auth/refresh
```

Seed users:

- `u_1001`: member user, can use cash shopping.
- `u_1002`: normal user, cannot use cash shopping, can use pure-points exchange.

Seed admin roles:

- `super_admin`: all permissions.
- `product_admin`: products, categories, stock, pure-points products.
- `order_admin`: orders and fulfillment.
- `finance_admin`: ledgers, refunds, withdrawals, exceptions.
- `customer_service`: order/user read and support notes only.

## Storage

Default JSON development store:

```text
dev/backend/data/dev-store.json
```

SQLite development store:

```bash
set TGG_STORE_DRIVER=sqlite
set TGG_SQLITE_FILE=D:\AI\tgg_shop-main\dev\backend\data\tgg-dev.sqlite
npm run dev
```

Throwaway in-memory run:

```bash
set TGG_STORE_MODE=memory
npm run dev
```

Generated runtime data under `dev/backend/data/` should not be committed.

## API Contract

The development API contract is maintained in:

```text
dev/backend/openapi.yaml
```

`npm test` validates that the implemented route surface is represented in the OpenAPI file.

## Implemented Business Coverage

- Normal users can earn/use points and place pure-points exchange orders.
- Cash shopping and cash shortfall payments require monthly membership.
- Pure-points exchange does not require membership and has no cash top-up entry.
- Member subscription creates a `member_open` payment flow.
- Cash goods orders create `goods_cash` payment orders.
- Points-plus-cash orders create `cash_diff` payment orders.
- Payment callbacks are idempotent and can create exception records on failure.
- Pure-points orders deduct points on successful submission.
- Refunds split cash and points back to their original ledgers.
- Pickup and delivery both use TGG self-built operations.
- Pickup points can be enabled/hidden by backend configuration.
- Pickup verification, delivery dispatch, delivery completion, refunds, and exception compensation have state logs.
- Backend permission boundaries separate product, order, finance, customer service, delivery, agent, audit, and super-admin responsibilities.

## User Frontend Coverage

- Home, product list, product detail, pure-points exchange, cart.
- Pickup checkout and delivery checkout.
- Membership opening.
- Orders, order detail, payment detail, fulfillment detail, refund request.
- Earn-points task list, task detail, task submission, submissions.
- Sign-in, invite, point ledger, payment records, ranking, withdrawal, address, pickup site, customer service and feedback placeholders.

## Admin Frontend Coverage

- Dashboard and metrics.
- Order management and order state machine diagnostics.
- Product and pure-points product management.
- Users and membership boundaries.
- Pickup sites, delivery teams, delivery staff.
- Task review, sign-in/ad configuration.
- Finance refunds, withdrawals, payment filters, timeout cancellation.
- Point/payment ledgers with idempotency keys.
- Role permissions and exception compensation center.

## Intentionally Mocked In MVP

- Real WeChat/Alipay payment and refund integrations.
- Real ad SDK playback/callbacks.
- Real bounty task platform credentialed proxy calls.
- Production password policy, refresh tokens, MFA, and centralized identity provider integration.
- Direct production SQL repositories and deployment configuration.
- SMS, push notification, object storage, and CDN.

## Recent Verification Snapshot

Latest local verification completed:

- Backend `npm test`: passed.
- Unit tests: 33 passed.
- Smoke tests: JSON and SQLite passed.
- Frontend syntax checks: user/admin app and render files passed.
- API E2E: member points-plus-cash shortfall payment and manual points secondary approval passed.
- Browser click patrol: user order detail and admin finance/state-machine flows passed.

## Handoff Risks

- `D:\AI\tgg_shop-main` is currently not a Git repository, so commit/push status cannot be verified from this folder.
- Several historical root documents and generated artifacts may have legacy encoding issues; new dev files should remain UTF-8.
- The MVP is suitable for flow validation, not production launch.
- Production readiness still needs framework choice, database finalization, MFA/password reset, payment provider callbacks, audit hardening, deployment scripts, and observability.

## Recommended Next Steps

1. Initialize or reconnect the correct Git repository and confirm remote/upstream.
2. Decide the production frontend target: existing web prototype, Vue/React web app, app WebView, or mini-program.
3. Harden authentication further with MFA, password reset, login risk scoring, and audit alerts.
4. Move write paths from state-backed repositories to direct SQL repositories.
5. Connect real payment/refund provider callbacks with signature verification.
6. Add deployment configuration, environment variables, logs, and monitoring.
7. Expand production-grade E2E around real payment callbacks, login sessions, and database transaction failures.
