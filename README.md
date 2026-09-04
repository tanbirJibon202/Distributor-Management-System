# DMS — Distributor Management System (Backend)

A cloud-based B2B supply-chain backend for FMCG/pharmaceutical distributors. Field Sales
Representatives (SRs) place credit orders on behalf of retail shops; the system enforces
per-shop credit limits, deducts branch inventory atomically, and settles orders through bKash.

**This is not e-commerce.** There is no cart, no public signup, and no browsing by buyers —
retailers never log in. The SR is the only actor who creates an order.

**Stack:** Node.js · Express 5 · TypeScript · Prisma · PostgreSQL · Redis · JWT · bKash Checkout

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
| `DATABASE_URL` | Postgres connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing keys — replace before deploying |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Token lifetimes (default `15m` / `7d`) |
| `CORS_ORIGINS` | Comma-separated allowlist |
| `GOOGLE_CLIENT_ID` | Required only for `POST /auth/google` |
| `REDIS_URL` | Used for the product-list cache and the bKash token cache |
| `BKASH_*` | bKash sandbox/production credentials — required only for the payment flow |
| `SUPER_ADMIN_*` | Demo super-admin credentials used by `prisma/seed.ts` |

**3. Migrate and generate the Prisma client**

```bash
npx prisma migrate dev --name init
npx prisma generate
```

**4. Seed demo data** (idempotent — safe to re-run)

```bash
npm run seed
```

**5. Run the server**

```bash
npm run dev
```

## Demo credentials (from the seed script)

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@dms.com` | `SuperAdmin123!` |
| Branch Manager (Dhaka) | `manager.dhaka@dms.com` | `Manager123!` |
| Branch Manager (Chattogram) | `manager.ctg@dms.com` | `Manager123!` |
| Field SR | `sr1@dms.com` | `FieldSr123!` |

The seed also creates 2 branches, 12 products (stocked in both branches), 6 retailers — one
(`Rahim General Store`) seeded close to its credit limit so the credit-block rule can be
demoed immediately — and a few orders in different statuses.

## Architecture

```
src/
  app.ts                  express app + middleware chain
  server.ts               bootstrap, db/redis connect, graceful shutdown
  config/index.ts         env vars validated with Zod — fail fast on boot
  modules/
    auth/ user/ branch/ product/ inventory/ retailer/ order/ payment/ audit/
      → each: route.ts, controller.ts, service.ts, (validation.ts / interface.ts)
  middlewares/
    auth.ts  authorize.ts  validateRequest.ts  globalErrorHandler.ts  notFound.ts
  utils/
    prisma.ts  redis.ts  sendResponse.ts  catchAsync.ts  AppError.ts
    pagination.ts  generateInvoiceNo.ts  jwt.ts
  routes/index.ts
prisma/
  schema.prisma  seed.ts
```

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

`POST /orders` (`src/modules/order/order.service.ts`) runs entirely inside one
`prisma.$transaction`, because three invariants have to hold together or not at all:

1. **Prices are computed server-side** from the `Product` table — a client can never dictate
   what it pays.
2. **The credit check runs inside the transaction.** `retailer.dueBalance + payableAmount`
   is compared against `creditLimit` using the row Postgres gives this transaction. Checking
   it *before* opening the transaction would let two concurrent orders from two different SRs
   both read the same stale `dueBalance`, both pass the check, and together blow past the
   retailer's credit limit.
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

## bKash payment flow and why the callback alone is never trusted

bKash's Checkout (URL-based) flow has **no signature-based webhook** the way Stripe does — a
callback hitting `/payments/callback` proves nothing on its own; anyone who guesses or
observes a `paymentID` could hit that URL. So the callback is only ever a trigger to go ask
bKash directly:

1. **Grant Token** — cached in Redis under `bkash:token` (bKash tokens last ~1 hour), so a new
   payment doesn't pay the grant round-trip every time.
2. **Create Payment** — returns a `paymentID` and a `bkashURL` the client redirects the payer
   to. The `paymentID` is stored on the `Payment` row before the payer ever sees the bKash page.
3. **Callback** — bKash redirects back with `paymentID` and `status`. `failure`/`cancel`
   marks the `Payment` row `FAILED` and stops there.
4. **Execute — the actual verification step.** The server calls bKash's `execute` endpoint
   with the `paymentID` and only trusts *that* response:
   - `transactionStatus` must be `Completed` and a `trxID` must be present.
   - The `amount` bKash returns must equal the `Payment.amount` stored at creation — a
     mismatch is rejected outright rather than trusted.
   - **Idempotency guard:** if the `Payment` is already `PAID`, the callback is a no-op —
     bKash is documented to sometimes fire the callback more than once for one payment.

Only after all three checks pass does the order's `paidAmount`/`paymentStatus` update and the
retailer's `dueBalance` decrease, all inside one transaction alongside the audit log write.

## API surface

All routes are prefixed `/api/v1`. See the published Postman collection for the full set with
example bodies. Summary:

```
POST   /auth/register            POST   /auth/login
POST   /auth/refresh-token       POST   /auth/google
GET    /auth/me

PATCH  /users/me
PATCH  /admin/users/:id/role     SUPER_ADMIN

POST   /branches                 SUPER_ADMIN
GET    /branches

POST   /products                 SUPER_ADMIN
GET    /products                 pagination + search + filter + sort, Redis-cached
GET    /products/:id
DELETE /products/:id             SUPER_ADMIN — soft delete, invalidates cache

PATCH  /inventory/adjust         BRANCH_MANAGER (own branch) | SUPER_ADMIN

POST   /retailers                SUPER_ADMIN | BRANCH_MANAGER
GET    /retailers/:id/credit-status

POST   /orders                   FIELD_SR
GET    /orders                   role-scoped, filter + pagination
PATCH  /orders/:id/status        BRANCH_MANAGER | SUPER_ADMIN

POST   /payments/initiate
POST   /payments/callback

GET    /admin/audit-logs         SUPER_ADMIN
```

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
npm run dev     # tsx watch — auto-reload during development
npm run build   # tsc typecheck + emit to dist/
npm run start   # run the built server once
npm run seed    # run prisma/seed.ts (idempotent)
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
movement history, SR beat plans/targets/commission, event streaming, file uploads, email
notifications.
