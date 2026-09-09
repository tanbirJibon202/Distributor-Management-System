# DMS — Distributor Management System

REST API for FMCG and pharmaceutical distribution in Bangladesh: sales reps take
orders from shops in the field, branch managers approve them and manage stock,
and admins oversee every branch. Retailers buy on credit and pay through bKash.
This repo is the backend only.

Stack: Node.js · Express 5 · TypeScript · Prisma 7 · PostgreSQL · Redis · JWT auth

## Where the project stands today

Every module described below works end to end: authentication with email OTP,
branches, products, per-branch inventory, retailers with credit limits, the order
lifecycle, bKash payments with refunds, PDF invoices, audit logging and dashboard
statistics.

What that sentence does not cover is worth stating up front. The regression tests
run against a Prisma double rather than a live PostgreSQL, the hourly cron does not
run on a serverless deployment, and several services — Redis, SMTP, Cloudinary,
bKash — are optional and behave differently when they are absent. Each of those is
explained in [Known limitations](#known-limitations). Read that section before
assuming something is broken on your end.

Only PostgreSQL is genuinely required. The app boots without any of the rest.

## Prerequisites

| Tool | Version | Check with |
| --- | --- | --- |
| Node.js | 20+ | `node -v` |
| PostgreSQL | 14+ | `psql -V` |
| Redis | 6+ *(optional)* | `redis-cli --version` |

Any package manager works. The examples below use npm.

## Getting started

**1. Install dependencies**

```bash
npm install
```

`postinstall` runs `prisma generate` for you, so step 3 is already done after a
fresh install. It is listed separately because you will need to re-run it.

**2. Set up your environment file**

```bash
cp .env.example .env
```

Open `.env` and point `DATABASE_URL` at a Postgres database you can connect to:

```
DATABASE_URL="postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/dms?schema=public"
DIRECT_URL="postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/dms?schema=public"
```

On plain local Postgres both variables hold the same value. They differ only on a
pooled provider — see [Environment variables](#environment-variables).

Set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to real random strings before
anything else; the placeholders in `.env.example` will not do:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Unlike many starters, this one validates the environment at startup and refuses to
boot on a missing or malformed variable, naming the one at fault. That is
deliberate: a missing JWT secret should stop the process, not surface as a failed
login three hours later.

**3. Generate the Prisma client**

```bash
npx prisma generate
```

Prisma 7 emits the client as TypeScript into `src/generated/prisma` — inside the
project, not into `node_modules`. That folder is git-ignored, so a fresh clone
never has it, and nearly every file under `src/` imports from it. Re-run this after
any change under `prisma/schema/`.

**4. Run the migrations**

```bash
npx prisma migrate deploy
```

This applies the seven migrations committed under `prisma/migrations/`. Use
`migrate dev` instead if you are changing the schema and want a new migration
generated.

**5. Start the server**

```bash
npm run dev
```

You should see the database connect, the seed run, and the port it is listening on.
Confirm it is up:

```bash
curl http://localhost:5000/
# {"success":true,"message":"Welcome to DMS - Distributor Management System Backend","data":{...}}
```

On first boot the seed creates a super admin from `SUPER_ADMIN_EMAIL` and
`SUPER_ADMIN_PASSWORD`. Log in with those to get your first token — every other
route needs one. Straight from `.env.example` that means:

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@dms.com","password":"SuperAdmin123!"}'
```

Those two values are local defaults, and the only account that exists before you
create anything. Change them in `.env` before you seed a database anyone else can
reach — the super admin can read every branch, change any role and delete users.

There is no public sign-up. `POST /auth/register` requires an admin or a branch
manager to be logged in already, so this seeded account is where every other user
comes from.

## Environment variables

`src/app/config/index.ts` is the only place `process.env` is read. Application code
imports `config` from there rather than reaching for `process.env` directly.

| Variable | What it's for |
| --- | --- |
| `NODE_ENV` | `development` includes the stack trace in error responses |
| `PORT` | Port the HTTP server listens on |
| `DATABASE_URL` | Connection string the running app uses |
| `DIRECT_URL` | Used only by `prisma migrate` — see below |
| `JWT_ACCESS_SECRET` | Signing key for access tokens |
| `JWT_REFRESH_SECRET` | Signing key for refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime, e.g. `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime, e.g. `7d` |
| `CORS_ORIGINS` | Comma-separated allowlist |
| `REDIS_URL` | Product cache, OTP storage, rate-limit counters, bKash tokens |
| `GOOGLE_CLIENT_ID` | Verifying Google ID tokens on `/auth/google` |
| `SMTP_*`, `EMAIL_SENDER` | OTP, password reset and invoice email |
| `CLOUDINARY_*` | Product and profile image uploads |
| `BKASH_*` | Tokenized checkout credentials and callback URL |
| `SUPER_ADMIN_*` | Seeded on first boot |

**Why two database URLs.** On a pooled provider such as Neon, `DATABASE_URL` points
at the pooled endpoint (the host containing `-pooler`) and `DIRECT_URL` at the
direct one. Migrations take an advisory lock and issue DDL, and a transaction
pooler breaks both. `prisma.config.ts` prefers `DIRECT_URL` for exactly this
reason. On plain Postgres with no pooler in front, set them to the same value.

## Project structure

```
src/
├── server.ts                     # connect, seed, register cron, listen, shut down
├── app.ts                        # express app: helmet, cors, rate limit, routes
├── generated/prisma/             # Prisma client — git-ignored, run `prisma generate`
└── app/
    ├── config/index.ts           # validates and exposes every environment variable
    ├── lib/                      # third-party clients: prisma, redis, bkash,
    │                             #   cloudinary, mailer, otp, multer, cron
    ├── middleware/
    │   ├── checkAuth.ts          # `auth(...roles)` — JWT verify and role guard
    │   ├── validateRequest.ts    # Zod on the body
    │   ├── validateQuery.ts      # Zod on the query string, and UUID params
    │   ├── globalErrorHandler.ts # every thrown error becomes one JSON shape
    │   └── notFound.ts
    ├── utils/
    │   ├── money.ts              # the Decimal rules — no float in a money path
    │   ├── orderAccess.ts        # the single definition of who may see an order
    │   ├── orderLock.ts          # `SELECT … FOR UPDATE` on an order row
    │   ├── invoicePdf.ts         # streams a PDF, writes no file
    │   ├── sendResponse.ts       # the `{ success, message, meta, data }` envelope
    │   └── seed.ts
    └── module/                   # analytics, audit, auth, branch, inventory,
                                  #   order, payment, product, retailer, user

prisma/
├── schema/                       # split across files, wired by prisma.config.ts
└── migrations/                   # generated SQL, committed

api/index.js                      # Vercel serverless entry — see Deployment
tests/regressions.test.ts         # 28 tests, mostly concurrency
```

Every module holds the same four or five files — `route`, `controller`, `service`,
`validation`, and an `interface` where the types are worth naming. The layering is
`route → controller → service`: controllers read `req`, call a service and hand the
result to `sendResponse`; **services own every Prisma call and every transaction**,
and controllers never touch Prisma.

## The API

Base URL: `http://localhost:5000/api/v1`

**Auth** — `/auth`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/register` | admin, manager | Stages the signup, emails an OTP |
| POST | `/verify-email` | – | The OTP creates the account |
| POST | `/resend-otp` | – | |
| POST | `/login` | – | |
| POST | `/refresh-token` | – | Reads the refresh cookie or body |
| POST | `/forgot-password` · `/reset-password` | – | OTP by email |
| POST | `/google` | – | Google ID token, existing staff only |
| POST | `/logout` | any | Revokes issued tokens |
| GET | `/me` | any | |

**Core resources**

| Method | Path | Auth |
| --- | --- | --- |
| POST · GET | `/branches` | admin · any |
| POST · GET | `/products` | admin · any |
| GET · PATCH · DELETE | `/products/:id` | any · admin · admin |
| PATCH | `/products/:id/image` | admin |
| GET | `/inventory` | any |
| PATCH | `/inventory/adjust` | admin, manager |
| POST · GET | `/retailers` | admin, manager · any |
| GET | `/retailers/:id/credit-status` | any |
| DELETE | `/retailers/:id` | admin, manager |

**Orders** — `/orders`

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/` | **SR only** |
| GET | `/` · `/:id` | any, scoped by role |
| PATCH | `/:id/status` | admin, manager |
| GET | `/:id/invoice` | any with access — streams a PDF |
| POST | `/:id/invoice/email` | any with access |

**Payments** — `/payments`

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/initiate` | any with access to the order |
| GET · POST | `/callback` | **none** — bKash calls this |
| GET | `/:id` | any with access |
| POST | `/:id/refund` | admin, manager |

**Admin** — `/admin`

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/users` | admin |
| PATCH | `/users/:id/role` | admin |
| DELETE | `/users/:id` | admin |
| GET | `/audit-logs` | admin |
| GET | `/dashboard-stats` | admin |

`PATCH /users/me` and `PATCH /users/me/image` are open to any authenticated role.

### Response shape

Every response carries the same envelope, success or failure:

```json
{ "success": true, "message": "...", "data": {} }
```

Paginated lists add `meta` with `page`, `limit`, `total` and `totalPage`. Failures
carry `errors`, an array that is empty unless validation produced field-level
detail:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "path": "email", "message": "Invalid email" }]
}
```

`GET /orders/:id/invoice` is the one route that breaks the contract — it streams a
PDF rather than JSON.

Import `DMS.postman_collection.json` for a working collection: 42 requests with
descriptions and captured example responses.

## Roles and authentication

Three roles, and the differences are not only about which routes they can reach:

| | SUPER_ADMIN | BRANCH_MANAGER | FIELD_SR |
| --- | --- | --- | --- |
| Branches, products, users | ✅ | – | – |
| Stock, retailers, order status | ✅ | own branch | – |
| Create orders | – | – | ✅ |
| Sees which orders | all | own branch | own only |

Two of those cells are deliberate rather than incidental. An SR creates orders but
cannot approve them — one person taking an order and clearing it themselves is
exactly the control a distributor needs. And a manager is confined to their own
branch, which is enforced in `assertOrderAccess` rather than repeated at each
endpoint, so the rule cannot drift between routes.

`auth(...roles)` in `middleware/checkAuth.ts` is both the JWT verify and the role
guard. It also rejects a token whose `tokenVersion` no longer matches the user row
— logout and password reset increment that column, which revokes tokens already
issued. That is the usual gap in JWT auth, closed with one extra comparison per
request.

Access tokens live 15 minutes, refresh tokens 7 days. Send the access token as
`Authorization: Bearer <token>`.

## Money and concurrency

This is the part of the codebase that had the most thought put into it, and the
part most worth reading if you are reviewing it.

**Money is `Prisma.Decimal` end to end.** `Decimal(12,2)` in the schema, `Decimal`
in the services, and a Zod schema in `utils/money.ts` that rejects more than two
decimal places. No float ever touches a monetary path. Amounts serialise as JSON
strings, which is why `"price": "12.50"` is correct rather than a bug.

**Balances and stock levels are never read then written.** Being inside
`$transaction` does not make that safe — PostgreSQL's default READ COMMITTED lets
two transactions read the same row before either writes. Both would pass the same
check and both would write, and one write would silently overwrite the other. So
the check is the update's condition:

```ts
const reserved = await tx.retailer.updateMany({
  where: { id, dueBalance: { lte: creditLimit.minus(payable) } },
  data:  { dueBalance: { increment: payable } },
});
if (reserved.count === 0) throw new AppError(400, 'Credit limit exceeded');
```

Stock decrements follow the same shape. Order items are sorted by product ID before
that loop so concurrent orders acquire row locks in the same order and cannot
deadlock. Payment and status transitions take `lockOrder()` — `SELECT … FOR UPDATE`
— before reading the order. Admin-membership changes serialise on a shared advisory
lock, so two admins cannot concurrently remove the last one.

**Network calls stay out of transactions.** bKash, SMTP and Cloudinary are all
called before the transaction opens or after it commits. Holding row locks across a
multi-second round trip turns a slow third party into database contention.

**The bKash callback is not trusted.** It carries no authentication — it cannot,
since bKash's server has no token — so it is treated as a hint that something
happened. The server then queries bKash directly and only credits the order if the
gateway confirms the payment and the amount matches. Refunds work the same way in
reverse: the gateway call succeeds first, and only then is the row marked
`REFUNDED`.

## Optional services

Only PostgreSQL is required. The rest degrade in one of two ways.

**503 with a message naming the variable to set** — SMTP, Cloudinary and bKash.
Configure them and the route works; leave them out and only that route fails, with
an error that says which variable is missing.

**Silent degradation** — Redis. The product cache falls through to Postgres, and
rate limiting falls back to per-instance counting via `AdaptiveRateLimitStore`,
which picks its backing store on first use rather than at import. Nothing fails;
you simply lose the cache and the shared counter.

## Known limitations

Worth knowing before you spend time debugging what looks like your own mistake:

- **The tests do not use a real database.** `tests/regressions.test.ts` runs against
  a Prisma double with an order mutex, so it exercises the service logic — that the
  code asks the right question — rather than PostgreSQL's own locking. The 28 tests
  cover concurrent gateway callbacks, untrusted callbacks, execute timeouts,
  initiation racing cancellation, inventory races and last-super-admin protection.
- **The cron does not run on a serverless deployment.** The hourly overdue and
  low-stock report is registered in `server.ts`, which Vercel never executes — it
  imports `api/index.js` instead. Use Vercel Cron to hit an endpoint on a schedule;
  the code does not need to change.
- **Seeding does not run there either**, for the same reason. Run migrations and
  seeding as a one-off against the database.
- **Branch type is a label.** `CENTRAL`, `DEPOT` and `BRANCH` describe the
  distribution hierarchy, but there is no inter-branch stock transfer, so all three
  behave identically today. The field is where that feature would hook in.
- **`routeArea` does not bind an SR to a territory.** An SR belongs to a branch;
  `routeArea` only filters retailers. Any SR in a branch can order for any retailer
  in it.
- **bKash is the only gateway.** `PaymentMethod` also lists `BANK_TRANSFER`, but
  nothing implements it.
- **Deletes are soft, and that has a visible consequence.** Deleting rewrites the
  natural key to `:deleted:<id>` so the original phone number or SKU becomes
  available again. You will see those values if you query the table directly.

## Extending this

New features go under `src/app/module/<name>/` as four or five files:

| File | Responsibility |
| --- | --- |
| `<name>.route.ts` | Wires `auth(...roles)` and validation to controllers |
| `<name>.controller.ts` | Reads `req`, calls the service, calls `sendResponse` |
| `<name>.service.ts` | All business logic, every Prisma call, every transaction |
| `<name>.validation.ts` | Zod schemas for body and query |
| `<name>.interface.ts` | Types worth naming |

Then mount it in `app.ts` beside the existing lines.

Three rules keep the boundaries real rather than decorative:

- **Controllers never call Prisma, services never touch `req` or `res`.** A service
  that needs to know its caller takes the small `{ userId, role, branchId }` shape.
- **Never read a balance or stock level and then write it back.** Use a conditional
  update and check `count`, as shown above.
- **Import Prisma from `src/generated/prisma/client.js`** by relative path, never
  from `@prisma/client`. Prisma 7 generates into the project.

Order status transitions live in a constant map in `module/order/order.interface.ts`
(`PENDING → APPROVED → DISPATCHED → DELIVERED`, with `CANCELLED` reachable from the
first two only). Add transitions there, not with ad-hoc checks.

## Scripts

```bash
npm run dev          # tsx watch on src/server.ts
npm run build        # prisma generate → tsc → copy .ejs templates into dist/
npm start            # run the built process entry
npm test             # 28 regression tests
npm run lint:check   # biome
npm run format:fix   # biome, writes
npx tsc --noEmit     # typecheck alone
```

Run a single test by name:

```bash
node --import tsx --test --test-name-pattern="concurrent cancellation" tests/*.test.ts
```

Prisma's CLI is called directly rather than wrapped:

```bash
npx prisma generate
npx prisma migrate deploy
npx prisma studio        # browser GUI at http://localhost:5555
```

## Deployment

There are two entry points and the difference matters.

`src/server.ts` is the long-lived process: connect, seed, register the cron
schedule, listen, shut down gracefully. `api/index.js` is the Vercel serverless
entry — it imports the same Express app from `dist/` and does none of that
bootstrap. Anything added to `server.ts` does not run on Vercel.

Redis is the one thing that had to be handled for serverless. `ensureRedis()` opens
the connection from the request path, and the serverless entry races it against a
short timeout, because the reconnect strategy retries forever and never rejects —
an unbounded await there hangs the entire invocation rather than failing the
request.

Two settings in `vercel.json` are not obvious:

- `installCommand: npm ci --include=dev`, because `NODE_ENV=production` otherwise
  makes npm skip devDependencies, which is where TypeScript and every `@types`
  package live.
- `app.set('trust proxy', 1)` in `app.ts` — one hop, not `true`. Without it the
  audit log records the proxy address for every action, rate limiting treats all
  callers as one client, and express-rate-limit refuses to start. `true` would let
  any caller spoof their address by setting the header themselves.

## Troubleshooting

**`Cannot find module '.../src/generated/prisma/client'`**
Run `npx prisma generate` — see step 3 of Getting started.

**The app refuses to start and names an environment variable**
That is the config validator doing its job. Set the variable it names in `.env`.

**`Can't reach database server` / `ECONNREFUSED`**
Postgres is not running, or `DATABASE_URL` points somewhere unreachable. Confirm
with `pg_isready -h localhost -p 5432`.

**Migrations hang or fail on a hosted database**
`DIRECT_URL` is probably pointing at a pooled endpoint. Drop `-pooler` from the
host — migrations need a direct connection.

**`401 Invalid or expired token` on a request that worked a moment ago**
Access tokens live 15 minutes. Log in again, or use `POST /auth/refresh-token`.

**`403` where you expected `200`**
The role is wrong for the route, or the record belongs to another branch or SR.
Check `GET /auth/me` for the role the token actually carries — a role changed in
the database does not apply until the next login.

**`409 A payment is already pending for this order`**
An earlier checkout is still open. Settle it through the callback route before
initiating another; this is the guard against double-charging.

**A route returns `503`**
An optional service is not configured. The message names the variable to set.

**`Too many requests`**
The rate limiter is working: 100 requests per 15 minutes globally, 5 on auth
routes. Wait it out, or raise the limits in `app.ts` for local work.
