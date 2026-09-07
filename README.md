# DMS — Distributor Management System (Backend)

A cloud-based B2B supply-chain backend for FMCG/pharmaceutical distributors. Field Sales
Representatives (SRs) place credit orders on behalf of retail shops; the system enforces
per-shop credit limits, deducts branch inventory atomically, and settles orders through bKash.

**This is not e-commerce.** There is no cart, no public signup, and no browsing by buyers —
retailers never log in. The SR is the only actor who creates an order. An admin or
branch manager authorizes staff registration; employees cannot self-assign a branch.

**Stack:** Node.js · Express 5 · TypeScript · Prisma · PostgreSQL · Redis · JWT · bKash Checkout

## Live API

```
https://distributor-management-system-seven.vercel.app/api/v1
```

Deployed to Vercel as a serverless function. `api/index.js` is the entry there;
`src/server.ts` remains the entry for a long-lived process (Render, a container,
local `npm run dev`). Two things only the process-based entry does: boot seeding
and the hourly cron report, neither of which a serverless deployment can hold.

## Roles

| Role | branchId | Scope |
|---|---|---|
| `SUPER_ADMIN` | null | Everything, all branches |
| `BRANCH_MANAGER` | required | Own branch only — 403 on any other branch |
| `FIELD_SR` | required | Creates orders; sees only their own orders |

## Getting started

**1. Install dependencies**

```bash
npm install
```

**2. Configure environment**

```bash
cp .env.example .env
```

Point `DATABASE_URL` at a reachable Postgres instance and `REDIS_URL` at a reachable Redis
instance. Environment variables are validated with Zod at startup — the process refuses to
boot if a required one (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) is missing.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` includes stack traces in error responses |
| `PORT` | HTTP port |
| `DATABASE_URL` | Postgres connection string used by the running app. On a pooled provider such as Neon, the **pooled** endpoint |
| `DIRECT_URL` | Same database, **direct** (non-pooled) endpoint. Read by `prisma.config.ts` and used only by the Prisma CLI — migrations take an advisory lock and run DDL, which a transaction pooler breaks. Optional: falls back to `DATABASE_URL` when unset, which is right on a plain Postgres with no pooler |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing keys — replace before deploying |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Token lifetimes (default `15m` / `7d`) |
| `CORS_ORIGINS` | Comma-separated allowlist |
| `GOOGLE_CLIENT_ID` | Required only for `POST /auth/google` |
| `REDIS_URL` | Product-list cache, bKash token cache, OTP and staged registrations, and rate-limit counters |
| `BKASH_*` | bKash sandbox/production credentials — required only for the payment flow |
| `SMTP_*` / `EMAIL_SENDER` | Required for registration, password reset and invoice email. Without them those routes return 503 and everything else works |
| `CLOUDINARY_*` | Required only for `PATCH /products/:id/image`; 503 without them |
| `SUPER_ADMIN_*` | Seeded super-admin credentials used by `src/app/utils/seed.ts`. `SUPER_ADMIN_EMAIL` is validated as an email at boot — the login route rejects anything else, so a value like `admin` would seed an account nobody could sign in to |

Redis, SMTP, Cloudinary and bKash are all optional. The app boots and serves without any of
them; only the routes that need one degrade, and Redis degrades silently — the product cache
falls through to Postgres and rate limiting falls back to per-instance counting. Postgres is
the only hard requirement.

**3. Migrate and generate the Prisma client**

```bash
npx prisma migrate deploy   # applies the committed migrations
npx prisma generate
```

Migrations resolve `DIRECT_URL`, so on a pooled provider they reach the database over the
direct endpoint while the app keeps using the pooled one.

**4. Run the server**

```bash
npm run dev
```

The super-admin is seeded on boot if none exists. Demo branches, users and orders are
seeded only when `NODE_ENV=development`; production and test never create demo accounts.
Production requires an explicit, non-default `SUPER_ADMIN_PASSWORD` of at least 12 characters.
Existing demo accounts from an earlier deployment are not removed automatically; review
and deactivate them before using that database in production.

## Demo credentials (seeded on first boot)

| Role | Email | Password |
|---|---|---|
| Super Admin | `SUPER_ADMIN_EMAIL` (default `admin@dms.com`) | `SUPER_ADMIN_PASSWORD` |
| Branch Manager (Dhaka) | `manager.dhaka@dms.com` | `Manager123!` |
| Branch Manager (Chattogram) | `manager.ctg@dms.com` | `Manager123!` |
| Field SR | `sr1@dms.com` | `FieldSr123!` |

The seed also creates 2 branches, 12 products (stocked in both branches), 6 retailers — one
(`Rahim General Store`) seeded close to its credit limit so the credit-block rule can be
demoed immediately — and a few orders in different statuses.

## Architecture

```
src/
  app.ts                       express app, middleware chain, route mounting
  server.ts                    bootstrap, db/redis connect, seeding, graceful shutdown
  app/
    config/index.ts            env vars validated with Zod — fail fast on boot
    interfaces/index.ts        shared query/filter types
    lib/                       external clients: prisma.ts (pg driver adapter), redis.ts,
                               bkash.ts, mailer.ts, cloudinary.ts, multer.ts, googleAuth.ts,
                               otp.ts, cron.ts, rateLimitStore.ts
    templates/                 .ejs email bodies, copied into dist/ at build time
    middleware/
      checkAuth.ts             auth(...roles) — JWT verify + role guard in one
      validateRequest.ts  globalErrorHandler.ts  notFound.ts
    module/
      auth/ user/ branch/ product/ inventory/ retailer/ order/ payment/ audit/
        → each: <name>.route.ts, .controller.ts, .service.ts, (.validation.ts / .interface.ts)
    utils/
      AppError.ts  catchAsync.ts  sendResponse.ts  pagination.ts
      generateInvoiceNo.ts  invoicePdf.ts  jwt.ts  seed.ts
  generated/prisma/            Prisma 7 client, emitted as TypeScript. Build output —
                               gitignored, regenerated by postinstall and by npm run build
scripts/copy-templates.mjs     copies .ejs templates into dist/ (tsc only emits .js)
prisma.config.ts               schema/migration paths, and the CLI's connection URL
prisma/
  schema/                      split schema: schema, enums, user, branch, product,
                               retailer, order, payment, audit
```

**On Prisma 7.** The client is generated into `src/generated/prisma` as plain TypeScript
instead of being patched into `node_modules`, and the app reaches Postgres through the `pg`
driver adapter rather than a bundled query engine. Connection URLs therefore live in two
places by design: `prisma.config.ts` holds the one the **CLI** uses for migrations
(`DIRECT_URL`), and `src/app/lib/prisma.ts` holds the one the **app** uses at runtime
(`DATABASE_URL`, pooled). Imports come from `src/generated/prisma/client.js`, not
`@prisma/client`.

**Controllers never call Prisma.** They parse `req`, call a service, and call `sendResponse`.
Services own all business logic, all Prisma calls, and every `$transaction`.

**Row-level scoping** is the same shape on every scoped endpoint:

```ts
const where =
  user.role === 'SUPER_ADMIN'    ? {}
: user.role === 'BRANCH_MANAGER' ? { branchId: user.branchId }
:                                  { srId: user.id };
```

## The order transaction — the core technical challenge

`POST /orders` (`src/app/module/order/order.service.ts`) runs entirely inside one
`prisma.$transaction`, because three invariants have to hold together or not at all:

1. **Prices are computed server-side** from the `Product` table — a client can never dictate
   what it pays.
2. **Credit is reserved by one conditional update inside the transaction.** The update
   increments `dueBalance` only if it still fits under `creditLimit - payableAmount`.
   A transaction around a separate read/check/write would still permit concurrent orders
   to exceed the credit limit. Prices, discounts and totals use Prisma Decimal arithmetic;
   inputs allow at most two decimal places and payable amount must be positive.
3. **Stock is deducted with a conditional `updateMany`, never read-then-write:**
   ```ts
   const res = await tx.branchInventory.updateMany({
     where: { branchId, productId, stock: { gte: quantity } },
     data: { stock: { decrement: quantity } },
   });
   if (res.count === 0) throw new AppError(400, `Insufficient stock for ${product.name}`);
   ```
   A plain "read the stock, check it, then write" has a race: two requests can both read
   `stock = 5`, both decide 5 is enough for a 5-unit order, and both succeed — leaving stock
   at −5. The conditional update makes the `stock >= quantity` check and the decrement one
   atomic database operation, so only one of two racing requests can ever win.

If anything after that throws — a missing product, an insufficient-stock item further down
the list, a credit breach — Postgres rolls back everything already written in the
transaction, including any stock already decremented for earlier items in the same order.

`PATCH /orders/:id/status` enforces a fixed state machine
(`PENDING → APPROVED → DISPATCHED → DELIVERED`, with `CANCELLED` reachable from `PENDING` or
`APPROVED`) defined as a constant map rather than scattered conditionals. Cancelling restores
stock and reverses the retailer's `dueBalance`, and is refused outright if the order already
has a successful payment.

## bKash payment flow

Payment reads and initiation enforce the same scope as orders: all branches for super-admins,
own branch for managers, and own orders for SRs. Cancelled and fully paid orders cannot start
checkout. Initiation returns `paymentId`, gateway `paymentID`, and `bkashURL`.

Initiation reserves an `UNPAID` payment inside a transaction before calling bKash. A second
pending checkout returns 409. Reservation, settlement and order status changes all lock the
same order row with `SELECT ... FOR UPDATE` before reading its current state. Cancellation
is rejected while any payment is pending or successful. A repeated cancellation cannot
restore stock or reverse credit twice. Gateway calls run outside database transactions.

Both GET and POST `/api/v1/payments/callback` accept `paymentID` and a callback `status`
(`success`, `failure`, or `cancel`). The callback is a trigger, not proof of payment:

- On success, execute the payment; if execution fails or is inconclusive, query its status.
- On failure/cancel, query the gateway before changing local state.
- Only a gateway-confirmed `Completed` response with the matching payment ID, amount and
  transaction ID settles the order. Duplicate callbacks leave the ledger unchanged.
- Gateway-confirmed terminal cancellation/failure/expiry marks the payment `FAILED`.
- Unknown status, gateway timeout or amount mismatch leaves the reservation pending. Retry
  the callback to reconcile; a browser cancellation alone never releases it.

If checkout creation fails before a URL is exposed, its local reservation is released.
If the gateway creates checkout but saving its ID fails, the reservation intentionally stays
pending. Operational reconciliation is required for this case; do not blindly mark an
unresolved gateway payment failed or retry collection. Previously created overlapping or
cancelled-order payments that would overpay are rejected for reconciliation.

## API surface

All routes are prefixed `/api/v1`. See the published Postman collection for the full set with
example bodies. Summary:

```
POST   /auth/register            step 1 — stages the account, emails a code, returns 202
POST   /auth/verify-email        step 2 — confirms the code, creates the user, returns tokens
POST   /auth/resend-otp          new code for a registration still staged
POST   /auth/login
POST   /auth/forgot-password     emails a reset code; same reply whether or not the account exists
POST   /auth/reset-password      verifies the code and sets the new password
POST   /auth/refresh-token       POST   /auth/google
GET    /auth/me                  POST   /auth/logout

PATCH  /users/me
PATCH  /users/me/image           any role — multipart, Cloudinary avatar
GET    /admin/users              SUPER_ADMIN — search + role/branch filter + pagination
PATCH  /admin/users/:id/role     SUPER_ADMIN
DELETE /admin/users/:id          SUPER_ADMIN — soft delete, blocks self and the last admin

POST   /branches                 SUPER_ADMIN
GET    /branches

POST   /products                 SUPER_ADMIN
GET    /products                 pagination + search + filter + sort, Redis-cached
GET    /products/:id
PATCH  /products/:id             SUPER_ADMIN — invalidates cache
PATCH  /products/:id/image       SUPER_ADMIN — multipart, Cloudinary, replaces the old file
DELETE /products/:id             SUPER_ADMIN — soft delete, invalidates cache

GET    /inventory                branch-scoped, ?lowStock= + search + pagination
PATCH  /inventory/adjust         BRANCH_MANAGER (own branch) | SUPER_ADMIN

POST   /retailers                SUPER_ADMIN | BRANCH_MANAGER
GET    /retailers                search + routeArea filter + pagination
GET    /retailers/:id/credit-status
DELETE /retailers/:id            SUPER_ADMIN | BRANCH_MANAGER — soft delete, blocked while due > 0

POST   /orders                   FIELD_SR
GET    /orders                   role-scoped, filter + pagination
GET    /orders/:id               role-scoped — 403 on another SR's or branch's order
GET    /orders/:id/invoice       role-scoped — application/pdf, not the JSON envelope
POST   /orders/:id/invoice/email same PDF, attached and mailed to retailers.email
PATCH  /orders/:id/status        BRANCH_MANAGER | SUPER_ADMIN

POST   /payments/initiate
GET    /payments/callback
POST   /payments/callback
GET    /payments/:id             payment status tracking
POST   /payments/:id/refund      SUPER_ADMIN | BRANCH_MANAGER — reverses a settled charge

GET    /admin/audit-logs         SUPER_ADMIN
GET    /admin/dashboard-stats    SUPER_ADMIN — totals, order status counts, revenue, low stock
```

**42 method/path combinations in total**, covering authentication with email verification and password reset,
profile/user management, core resource CRUD with soft deletes, business workflows
(credit-checked ordering and the order state machine), search/filter/sort/pagination, the bKash
payment lifecycle including gateway-confirmed refunds, PDF invoicing by download or email,
image upload, and admin operations.

## Staff registration is two steps

`POST /auth/register` requires an admin or branch-manager Bearer token. Managers can
register an SR only in their own branch. The submitted name/email/password belong to the
new employee, not the administrator. The approval identity is recorded with the pending
registration and rechecked during activation. The endpoint does **not** create the account and does **not** return tokens — it
answers `202` after staging the signup in Redis for five minutes and emailing a six-digit code.
`POST /auth/verify-email` consumes that code, creates the user, and returns the tokens.

Keeping the pending signup out of Postgres means an abandoned or fraudulent registration leaves
nothing behind: no half-built row holding the email address hostage, and no cleanup job to
delete them later. The address is only taken once someone proves they own it.

Codes are consumed atomically in Redis, expire in five minutes, and allow five attempts before being invalidated
— the per-IP rate limiter does not protect one account from a script, so the attempt cap is
what actually makes a six-digit code strong. `POST /auth/forgot-password` deliberately gives
the same answer whether or not an account exists, so it cannot be used to discover which
addresses are registered.

Google sign-in requires a verified Google email matching an already approved staff account;
it never creates new staff or silently overwrites a linked Google identity. Logout requires
a valid access token and revokes all sessions for that user. Password reset also revokes old
access/refresh tokens by incrementing the database `tokenVersion`.

## Background jobs

One in-process schedule, registered at boot (`src/app/lib/cron.ts`): hourly, it reports orders
past `dueDate` that are neither paid nor cancelled, and inventory rows at or below ten units.
It is read-only by design — `dueDate` is a stored fact, so "overdue" stays a query rather than
another derived column to keep in step. Notifications would hook in here.

Note it runs in every instance: scaling past one requires a Redis lock so only one reports.

## Response conventions

```json
{ "success": true, "message": "Operation successful", "data": {} }
```

Paginated endpoints add a `meta` block: `{ "page": 1, "limit": 10, "total": 45, "totalPage": 5 }`.

```json
{ "success": false, "message": "Validation failed", "errors": [{ "path": "email", "message": "Invalid email" }] }
```

The global error handler maps Zod errors → 400, `AppError` → its own status code, Prisma
`P2002` → 409, `P2025` → 404, JWT errors → 401, and anything else → 500. Stack traces are only
included when `NODE_ENV=development`.

## Scripts

```bash
npm test        # HTTP/service regressions with mocked database and gateway
npm run dev     # tsx watch — auto-reload during development
npm run build   # prisma generate + tsc typecheck and emit to dist/
npm run start   # run the built server once
```

## Deploying to Render

Render is the deploy target rather than Vercel because this service needs a persistent
process: it holds a Redis connection and has to receive bKash callbacks.

`render.yaml` is a ready blueprint. Deploying manually instead:

- **Build command:** `npm install && npm run build && npx prisma migrate deploy`
- **Start command:** `npm run start`
- **Health check path:** `/`

`prisma generate` runs from `postinstall`, so the Prisma client is always generated in the
deploy environment. Set `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, the `JWT_*` secrets, and
the `BKASH_*` credentials in Render's environment settings — the app refuses to boot without
the required ones. Point `BKASH_CALLBACK_URL` at the deployed
`https://<your-service>.onrender.com/api/v1/payments/callback`.

## Out of scope for v1

Deliberately not built, but the schema (e.g. `Branch.type`, `Order.dueDate`) is shaped so
these can be added later without destructive migrations: batch/lot/expiry tracking, inter-branch
stock transfers, suppliers/purchase orders/GRN, sales returns, a retailer ledger table, stock
movement history, SR beat plans/targets/commission and event streaming.

## Validation and regression checks

List endpoints validate pagination, enum filters, sorting, search strings, price ranges,
and branch IDs before querying Prisma. `page` is an integer from 1 to 1,000,000 and `limit`
from 1 to 100. Duplicate query values, unsupported fields and invalid resource UUIDs return
structured 400 errors. Authorization uses the current database role and branch, so a token
issued before demotion cannot retain admin access.

`npm test` covers stale-role tokens, scoped payment access, invalid HTTP input, duplicate
settlement/cancellation, checkout reservation races, gateway failures and production seed
protection. The service concurrency tests use a database double with an order mutex, not a
live PostgreSQL instance. They do not replace PostgreSQL concurrency testing or a bKash
sandbox checkout/callback test before deployment.

## Business scope and deployment update

Retailers and their credit limits are shared across distributor branches. Products are also
shared, while inventory is per branch and orders are owned by an SR and branch. A pending
order reserves inventory and credit immediately. Manager approval moves it through dispatch
and delivery; cancellation releases both reservations once. SR-entered discounts remain
subject to manager review of the pending order, with no configurable discount ceiling in v1.

Apply the committed `20260907150000_user_token_version` migration before starting this version:

```bash
npx prisma migrate deploy
npm run build
```

The migration adds a non-null session version with default zero, preserving existing user
rows. It is committed as a file; development checks do not apply it to your configured database.
Read [architecture and business review](docs/architecture-review.md) for the Healthcare
comparison, corrected logic and remaining v1 boundaries.
