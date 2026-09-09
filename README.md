# DMS — Distributor Management System

A backend for the way FMCG and pharmaceutical distribution actually works here. A Field Sales
Representative walks a route, takes orders from shops on credit, and the distributor collects
the money later. This service is the system of record for that: the product catalogue, the
stock sitting in each branch, every shop's credit limit, and the orders moving between them.

It is not an e-commerce API. Retailers never log in — they are business records, not user
accounts. There is no cart and no public signup. The SR is the only person who creates an
order, and staff accounts are created by an admin or a branch manager, never by the employee
themselves.

**Live:** https://distributor-management-system-seven.vercel.app/api/v1

**Stack:** Node.js · TypeScript · Express 5 · PostgreSQL · Prisma 7 · Redis · JWT · bKash

## Roles

Three roles, and every scoped query has the same shape.

| Role | Branch | What they reach |
|---|---|---|
| `SUPER_ADMIN` | none | Everything, across all branches |
| `BRANCH_MANAGER` | required | Their own branch only |
| `FIELD_SR` | required | Creates orders; sees only their own |

```ts
const where =
  actor.role === 'SUPER_ADMIN'    ? {}
: actor.role === 'BRANCH_MANAGER' ? { branchId: actor.branchId }
:                                   { srId: actor.userId };
```

Products and retailers — including credit limits — are shared across branches. Inventory is per
branch, and an order belongs to one SR and one branch.

## Running it

```bash
npm install
cp .env.example .env      # DATABASE_URL and the JWT secrets at minimum
npx prisma migrate deploy
npm run dev
```

Environment variables are parsed with Zod at boot, so a missing or malformed one stops the
process with a message rather than failing later at the first request that needed it.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | What the app connects with. On a pooled provider like Neon, the pooled endpoint |
| `DIRECT_URL` | Same database, direct endpoint. Only the Prisma CLI uses it — migrations take an advisory lock and issue DDL, and a transaction pooler breaks both. Falls back to `DATABASE_URL` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Required |
| `REDIS_URL` | Product cache, bKash tokens, OTPs, staged registrations, rate-limit counters |
| `SMTP_*`, `EMAIL_SENDER` | Registration codes, password resets, invoice email |
| `CLOUDINARY_*` | Product and profile images |
| `BKASH_*` | Gateway credentials and the callback URL |
| `SUPER_ADMIN_*` | Seeded admin. The email is validated as an email — the login route rejects anything else, so a value like `admin` would seed an account nobody could sign in to |

Only PostgreSQL is required. Redis, SMTP, Cloudinary and bKash are optional: the app boots
without them and only the routes needing one degrade. Redis degrades silently — the product
cache falls through to Postgres, rate limiting counts per instance — while the others answer
503 naming the variable to set.

## Seeded accounts

Demo data is seeded on boot in development only. Production and test never create demo
accounts, and production refuses to start on a default or short admin password.

| Role | Email | Password |
|---|---|---|
| Super Admin | `tanbirahamed202@gmail.com` | `DmsSuperAdmin@2026` |
| Branch Manager (Dhaka) | `manager.dhaka@dms.com` | `Manager123!` |
| Branch Manager (Chattogram) | `manager.ctg@dms.com` | `Manager123!` |
| Field SR | `sr1@dms.com` | `FieldSr123!` |

Plus two branches, twelve products stocked in both, and six retailers — one of them
(`Rahim General Store`) deliberately close to its credit limit, so the credit block can be
demonstrated without setting anything up first.

The deployed instance runs with `NODE_ENV=production`, so none of the demo data exists
there — only the super admin, whose credentials are the first row above. Branches, products
and staff are created through the API, which is also the honest way to see the system work.
Running locally, the super admin comes from whatever `SUPER_ADMIN_EMAIL` and
`SUPER_ADMIN_PASSWORD` are set to in your own `.env`.

## Layout

```
src/
  app.ts                    middleware chain and route mounting
  server.ts                 the long-lived process: connect, seed, schedule, listen
  app/
    config/                 env parsed and validated with Zod
    lib/                    prisma, redis, bkash, mailer, cloudinary, multer, otp, cron
    middleware/             auth guard, validation, error handler, 404
    module/<feature>/       route · controller · service · validation
    templates/              .ejs email bodies
    utils/                  AppError, pagination, invoice PDF, money, locks
api/index.js                serverless entry (Vercel)
prisma/schema/              schema split by aggregate
tests/                      regression tests over the concurrency paths
```

Controllers never touch Prisma. They read the request, call a service, hand the result to
`sendResponse`. Services own the business rules, every query and every transaction. Holding
that line is what stops a rule quietly existing in two places with two different answers.

## The order transaction

`POST /orders` is where most of the thinking went. Three things have to hold together or none
of them do.

**Prices come from the database, never the request.** The client sends product IDs and
quantities; unit price, subtotal and payable amount are computed server-side. No caller can
dictate what it pays.

**Credit is reserved by a conditional update, not a read and then a write.**

```ts
const reserved = await tx.retailer.updateMany({
  where: { id, deletedAt: null, dueBalance: { lte: creditLimit.minus(payable) } },
  data:  { dueBalance: { increment: payable } },
});
if (reserved.count === 0) throw new AppError(400, 'Credit limit exceeded');
```

Being inside a transaction does not make a read-then-write safe. Postgres runs at READ
COMMITTED by default, so two orders for the same shop can both read the same balance, both pass
a plain comparison, and both increment — putting the retailer over their limit. Checking and
incrementing in one statement is what lets the database serialise them.

**Stock is decremented the same way**, with `stock: { gte: quantity }` in the `where`, so two
SRs racing for the last carton cannot both win. Items are sorted by product ID before the loop
so concurrent orders take row locks in the same order and cannot deadlock against each other.

A pending order reserves both inventory and credit immediately. Manager approval moves it
through dispatch and delivery; cancelling releases both reservations exactly once.

Money is `Decimal` end to end. Floating point is not a currency type, and a fraction of a paisa
surviving a few thousand orders becomes a real discrepancy in a ledger.

## Payments

bKash tokenized checkout: create → customer pays → callback → execute.

The callback is never trusted on its own. Anyone can hit that URL with a plausible query
string, so nothing is credited until the server calls bKash's execute endpoint and gets back a
completed transaction with a matching amount. If execute times out without a verdict the
payment stays pending and a status query reconciles it later — a timeout is not a failure, and
treating it as one drops real money.

Initiating twice for one order returns 409 while a payment is pending. Without that, two
checkout sessions for the same invoice can both complete and the shop pays twice.

A settled payment can be reversed with `POST /payments/:id/refund`, which calls the gateway and
walks the money back through the same totals the settlement moved. It is a separate endpoint
rather than a step inside cancellation, because returning money is a decision someone makes:
role-restricted, a written reason required, and audited. That is also what makes a paid order
cancellable — refund first, then cancel.

The gateway's own reply is stored verbatim on the payment row. When a charge is disputed, what
the gateway actually said is the only authoritative record, and it cannot be reconstructed from
derived columns afterwards.

## Registration is two steps

`POST /auth/register` does not create an account. An admin or the branch's own manager calls it;
it stages the signup in Redis for five minutes and emails a six-digit code. `POST
/auth/verify-email` consumes the code and creates the user.

Keeping the pending signup out of Postgres means an abandoned registration leaves nothing
behind — no half-built row holding an email address, no cleanup job to delete them later. The
address is only taken once someone proves they own it.

Codes are single use, expire in five minutes, and allow five attempts. The attempt cap is what
actually makes a six-digit code strong: a per-IP rate limiter does nothing to stop a script
working through a million possibilities against one account. Checking, counting and consuming
happen in a single Redis operation, so two concurrent requests cannot both spend one code.

`POST /auth/forgot-password` answers identically whether or not the account exists. A different
message for an unknown address turns the endpoint into a way to discover who has an account.

## API surface

All routes are prefixed `/api/v1`. The Postman collection has every request with a description
and real example responses, successes and failures alike.

```
POST   /auth/register            admin-initiated; stages the account and emails a code (202)
POST   /auth/verify-email        confirms the code, creates the user, returns tokens
POST   /auth/resend-otp          new code for a registration still staged
POST   /auth/login               POST /auth/refresh-token    POST /auth/logout
POST   /auth/google              GET  /auth/me
POST   /auth/forgot-password     POST /auth/reset-password

PATCH  /users/me                 PATCH /users/me/image
GET    /admin/users              search, role and branch filter, pagination
PATCH  /admin/users/:id/role     DELETE /admin/users/:id

POST   /branches                 GET /branches

POST   /products                 GET /products     search, filter, sort, paginate, cached
GET    /products/:id             PATCH /products/:id
PATCH  /products/:id/image       DELETE /products/:id

GET    /inventory                branch-scoped, ?lowStock=
PATCH  /inventory/adjust

POST   /retailers                GET /retailers    search and route filter
GET    /retailers/:id/credit-status
DELETE /retailers/:id            blocked while the shop still owes money

POST   /orders                   FIELD_SR
GET    /orders                   GET /orders/:id       role-scoped
GET    /orders/:id/invoice       PDF
POST   /orders/:id/invoice/email the same PDF, mailed to the retailer
PATCH  /orders/:id/status        the fulfilment state machine

POST   /payments/initiate        GET/POST /payments/callback
GET    /payments/:id             POST /payments/:id/refund

GET    /admin/audit-logs         GET /admin/dashboard-stats
```

Forty-two method and path combinations.

## Responses

```json
{ "success": true, "message": "Operation successful", "data": {} }
```

Paginated endpoints add `meta`: `{ "page": 1, "limit": 10, "total": 45, "totalPage": 5 }`.

```json
{ "success": false, "message": "Validation failed", "errors": [{ "path": "email", "message": "Invalid email" }] }
```

`GET /orders/:id/invoice` is the one exception — it returns `application/pdf`.

The global handler maps Zod errors to 400, `AppError` to its own status, Prisma `P2002` to 409,
`P2025` to 404, `P2034` (a serialisable transaction that lost a race) to 409 with a retry
message, and JWT errors to 401. Stack traces appear only when `NODE_ENV=development`.

## Security

Passwords are bcrypt at 12 rounds. Access tokens last 15 minutes; refresh tokens live 7 days in
an httpOnly cookie. Every user row carries a `tokenVersion` that logout and password reset
increment, revoking tokens already handed out — without it, "sign out everywhere" only signs out
the tab you clicked in.

`helmet` sets the security headers, CORS runs from an allowlist, and rate limiting is two-tier:
100 requests per 15 minutes globally, 5 on the auth routes. Counters live in Redis when it is
reachable, so one limit is shared across instances, and fall back to per-instance counting when
it is not.

Express trusts exactly one proxy hop. Behind a platform proxy the client address arrives in
`X-Forwarded-For`; without that setting the audit log records the proxy for every action and
rate limiting treats every caller as one client. Trusting the whole chain would let anyone spoof
their address by setting the header themselves.

Soft deletes never hard-remove a row. Because `email`, `sku` and `phone` are unique, deletion
also appends `:deleted:<id>` to the natural key so the value can be reused later.

Every state change — orders, roles, deactivations, refunds, inventory adjustments — is written
to an audit log with the actor and their IP.

## Testing

```bash
npm test          # 28 regression tests
npm run lint:check
npm run build
```

The tests aim at what type checking and linting cannot reach: concurrent gateway callbacks
settling one payment exactly once, an untrusted failure callback that must not release a pending
payment, execute timeouts reconciled against a status query, initiation racing cancellation,
concurrent inventory adjustments that must not fall below zero, and demotions that must not
remove the last super admin.

They use a database double with an order mutex rather than a live PostgreSQL instance, so they
demonstrate the logic rather than the database's own locking. A real concurrency run against
PostgreSQL, and a full bKash sandbox checkout, are still worth doing before trusting a
production deployment.

## Deployment

Deployed to Vercel. `api/index.js` is the serverless entry; `src/server.ts` remains the entry
for a long-lived process — Render, a container, or `npm run dev`.

Two things only the process-based entry does, worth knowing before choosing a target: boot
seeding, and the hourly job reporting overdue orders and low stock. Serverless has no persistent
process to hold a schedule, so on Vercel that job needs Vercel Cron. Migrations belong in the
build either way. `render.yaml` is a working blueprint for Render, where both run normally.

## Not built

Deliberately out of scope, though the schema leaves room: batch and expiry tracking,
inter-branch stock transfers, purchase orders and GRN, sales returns, a retailer ledger table,
stock movement history, SR beat plans and commission, and configurable discount ceilings — SR
discounts stay subject to manager review of the pending order.
