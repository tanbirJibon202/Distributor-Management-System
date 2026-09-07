# DMS — বাংলা Viva ও Video Demonstration Guide

**Project:** DMS — Distributor Management System  
**Target duration:** ৯–১০ মিনিট  
**Language:** বাংলা, সঙ্গে প্রয়োজনীয় English technical terms

> “বলবে” অংশগুলো মুখে বলার script। “দেখাবে” অংশগুলো recording নির্দেশনা। Response ও status code নিচে code অনুযায়ী expected; recording-এর আগে actual server-এ rehearsal করতে হবে। এই guide লেখা মানে live API বা payment test passed নয়।

## ১. Recording-এর আগে প্রস্তুতি

Project folder থেকে server চালাও:

```powershell
npm run dev
```

Postman-এ [DMS.postman_collection.json](../DMS.postman_collection.json) import করো। Collection variables তৈরি করো:

| Variable | Value |
|---|---|
| `baseUrl` | `http://localhost:5000/api/v1` অথবা deployed API base URL |
| `adminToken` | Admin login-এর `data.accessToken` |
| `managerToken` | Manager login-এর `data.accessToken` |
| `srToken` | SR login-এর `data.accessToken` |
| `branchId` | Manager ও SR-এর একই branch-এর actual ID |
| `otherBranchId` | অন্য branch-এর actual ID |
| `productId` | Order-এর জন্য active এবং stock থাকা product ID |
| `demoProductId` | CRUD demo-তে তৈরি product ID |
| `retailerId` | পর্যাপ্ত available credit থাকা retailer ID |
| `orderId` | Demo-তে তৈরি order ID |
| `paymentId` | Initiate response-এর local payment ID |

Existing collection-এর default token variable `accessToken`। এই guide অনুসরণ করার সময় প্রতিটি protected request-এর Authorization → Bearer Token-এ সংশ্লিষ্ট `{{adminToken}}`, `{{managerToken}}` বা `{{srToken}}` বসাবে।

Development seed থাকলে account:

| Role | Email | Password |
|---|---|---|
| Super Admin | Configured `SUPER_ADMIN_EMAIL` | Configured password |
| Branch Manager | `manager.dhaka@dms.com` | `Manager123!` |
| Field SR | `sr1@dms.com` | `FieldSr123!` |

এগুলো development seed-এর account; production-এ demo account তৈরি হয় না। Password পরিবর্তন করে থাকলে current password ব্যবহার করবে।

### Rehearsal checklist

- তিন role দিয়ে login করে token প্রস্তুত করো।
- `GET /auth/me` থেকে manager/SR-এর branch মিলিয়ে নাও।
- Admin দিয়ে `GET /branches` থেকে অন্য branch ID রাখো।
- `GET /inventory` ও `GET /products` থেকে order-এর product বেছে নাও।
- `GET /retailers` ও credit-status endpoint থেকে retailer বেছে নাও।
- CRUD product এবং order product আলাদা রাখো; CRUD product delete করা হবে।
- bKash sandbox credentials ও reachable callback URL দিয়ে checkout rehearsal করো।
- Cancel demonstration-এর জন্য দ্বিতীয় unpaid order ও checkout প্রস্তুত রাখো।
- `.env`, API secrets, payment PIN recording-এ দেখাবে না।
- Token বদলিয়েও ভুল role এলে Postman-এর `accessToken` cookie clear করো; middleware cookie-কে header-এর আগে পড়ে।
- `npm test` ও `npm run build` চালিয়ে actual result প্রস্তুত রাখো।

## ২. সময় ভাগ

| সময় | বিষয় |
|---|---|
| 0:00–0:45 | Problem ও project overview |
| 0:45–1:35 | Architecture |
| 1:35–2:10 | Database design |
| 2:10–3:00 | তিন role-এর login |
| 3:00–4:10 | Admin product CRUD |
| 4:10–5:00 | Manager operation ও 403 |
| 5:00–6:00 | SR order ও manager approval |
| 6:00–6:40 | Validation ও errors |
| 6:40–8:25 | Payment flow |
| 8:25–9:25 | Technical challenge |
| 9:25–10:00 | Testing ও deployment |

সময় ধরে রাখতে request tabs, bodies এবং code files আগে খুলে রাখবে। Payment checkout-এর external delay হলে সংক্ষিপ্ত বিরতি edit করতে পারো; actual outcome বদলাবে না।

## ৩. Project overview — 0:00–0:45

**দেখাবে:** [README](../README.md) ও VS Code folder structure।

**বলবে:**

> আসসালামু আলাইকুম। আমার project-এর নাম DMS—Distributor Management System। এই backend distributor company-র branch inventory, retailer credit, sales order এবং payment manage করার জন্য তৈরি করেছি।
>
> বাস্তবে sales representative দোকান থেকে order সংগ্রহ করেন। তখন জানা দরকার branch-এ পর্যাপ্ত stock আছে কি না, দোকানের আগের বকেয়া কত এবং নতুন order credit limit অতিক্রম করছে কি না। আমার system এই business rules enforce করে এবং bKash payment-এর মাধ্যমে বকেয়া সমন্বয় করে।
>
> এখানে retailer একটি business record; retailer নিজে login করে না। Field SR retailer-এর হয়ে order তৈরি করে। Stack হিসেবে Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis এবং JWT ব্যবহার করেছি।

## ৪. Architecture — 0:45–1:35

**দেখাবে:** [src/app.ts](../src/app.ts), route mounting অংশ।

```ts
app.use('/api/v1/products', ProductRoutes);
app.use('/api/v1/orders', OrderRoutes);
app.use('/api/v1/payments', PaymentRoutes);
```

**বলবে:**

> এখানে Express application configure করা হয়েছে। JSON parsing, CORS, Helmet ও rate limiting-এর common middleware আছে। প্রতিটি module-এর route `/api/v1` prefix-এর নিচে mount করা হয়েছে।

এরপর নিচের file তিনটি পর্যায়ক্রমে দেখাবে:

| File | অংশ | বলবে |
|---|---|---|
| [product.route.ts](../src/app/module/product/product.route.ts) | `router.post` | Route endpoint, allowed role, validation ও controller নির্ধারণ করে। |
| [product.controller.ts](../src/app/module/product/product.controller.ts) | `createProduct` | Controller request data নিয়ে service call করে এবং standard response দেয়। |
| [product.service.ts](../src/app/module/product/product.service.ts) | `createProduct` | Service business logic handle করে। Prisma দিয়ে product ও audit log একই transaction-এ তৈরি হয়। |

**বলবে:**

> Request flow হচ্ছে Routes → Authentication ও Validation Middleware → Controllers → Services → Prisma → PostgreSQL। এই separation-এর ফলে controller ছোট থাকে এবং business logic আলাদাভাবে test ও maintain করা যায়।

## ৫. Database design — 1:35–2:10

**দেখাবে:** [product.prisma](../prisma/schema/product.prisma)।

**বলবে:**

> Product-এর common information এক জায়গায় আছে, কিন্তু stock branch অনুযায়ী আলাদা। তাই BranchInventory model-এ branchId, productId ও stock রেখেছি। branchId এবং productId একসঙ্গে unique, যাতে duplicate inventory row না হয়।

**দেখাবে:** [order.prisma](../prisma/schema/order.prisma)।

**বলবে:**

> একটি order একটি branch, একজন SR এবং একজন retailer-এর সঙ্গে connected। একটি order-এর একাধিক OrderItem থাকে। OrderItem-এ unitPrice সংরক্ষণ করেছি, যাতে product price পরিবর্তন হলেও পুরোনো invoice-এর হিসাব না বদলায়।

**দেখাবে:** [retailer.prisma](../prisma/schema/retailer.prisma)।

**বলবে:**

> Retailer-এর creditLimit ও dueBalance দিয়ে নতুন credit order গ্রহণ করা যাবে কি না নির্ধারণ করি। Monetary fields-এ Decimal ব্যবহার করেছি।

## ৬. তিন role-এর login — 2:10–3:00

**দেখাবে:** Postman। প্রতিটি account দিয়ে:

```http
POST {{baseUrl}}/auth/login
Content-Type: application/json
```

Admin body-তে নিজের configured credentials দেবে। Manager body:

```json
{
  "email": "manager.dhaka@dms.com",
  "password": "Manager123!"
}
```

SR body:

```json
{
  "email": "sr1@dms.com",
  "password": "FieldSr123!"
}
```

প্রত্যেক response-এর `data.accessToken` সংশ্লিষ্ট variable-এ save করবে। Expected: `200 OK`।

**বলবে:**

> এখানে তিনটি role দিয়ে actual login করছি। Super Admin system-wide administrative কাজ করেন। Branch Manager নিজের branch-এর inventory ও order workflow manage করেন। Field SR retailer-এর হয়ে order তৈরি করেন এবং নিজের order দেখতে পারেন।

Identity দেখাতে:

```http
GET {{baseUrl}}/auth/me
Authorization: Bearer {{srToken}}
```

**দেখাবে:** [checkAuth.ts](../src/app/middleware/checkAuth.ts), `auth` function।

**বলবে:**

> Token verify করার পরে middleware database থেকে current user ও role পড়ে। Deleted user এবং revoked session reject করে। তাই শুধু পুরোনো token-এর role claim-এর ওপর নির্ভর করতে হয় না।

## ৭. Admin product CRUD — 3:00–4:10

সব request-এ `Authorization: Bearer {{adminToken}}` ব্যবহার করো। Body থাকলে raw JSON নির্বাচন করো।

### Create

```http
POST {{baseUrl}}/products
```

```json
{
  "name": "Viva Demo Biscuit",
  "sku": "VIVA-BISCUIT-001",
  "description": "Product for API demonstration",
  "category": "Snacks",
  "unit": "PCS",
  "price": 100,
  "costPrice": 80
}
```

Expected: `201 Created`। `data.id` → `demoProductId`। প্রতিবার rehearsal/recording-এ নতুন SKU নেবে; soft delete হলেও পুরোনো SKU unique থাকে।

**বলবে:**

> Super Admin দিয়ে product create করছি। Valid request-এর জন্য 201 Created পাচ্ছি এবং database-generated ID response-এ এসেছে।

### Read

```http
GET {{baseUrl}}/products/{{demoProductId}}
```

Expected: `200 OK`।

> Returned ID দিয়ে product retrieve করছি।

### Update

```http
PATCH {{baseUrl}}/products/{{demoProductId}}
```

```json
{
  "price": 110,
  "description": "Updated during viva demonstration"
}
```

Expected: `200 OK`; response-এ updated price দেখাবে।

> PATCH দিয়ে নির্দিষ্ট fields update করছি। পুরো resource আবার পাঠাতে হচ্ছে না।

### Delete

```http
DELETE {{baseUrl}}/products/{{demoProductId}}
```

Expected: `200 OK`।

> এখানে soft delete করেছি। Record physically remove না করে deletedAt set করা হয়, যাতে historical reference থাকে।

আবার একই ID দিয়ে GET করো। Expected: `404 Not Found`, message: `Product not found`।

> Delete-এর পরে normal product lookup-এ resource আর পাওয়া যাচ্ছে না।

## ৮. Manager permission ও 403 — 4:10–5:00

### Allowed operation

```http
PATCH {{baseUrl}}/inventory/adjust
Authorization: Bearer {{managerToken}}
```

```json
{
  "productId": "{{productId}}",
  "branchId": "{{branchId}}",
  "quantity": 10,
  "reason": "Demo stock received"
}
```

Expected: `200 OK`। এখানে order-এর existing product ব্যবহার করবে, deleted CRUD product নয়।

**বলবে:**

> Branch Manager নিজের branch-এ stock যোগ করতে পারছেন। Positive quantity stock বাড়ায়। Negative adjustment-এর সময় stock zero-এর নিচে নামতে দেওয়া হয় না।

### Cross-branch forbidden

একই request-এ `branchId` বদলে `{{otherBranchId}}` দাও। Expected: `403 Forbidden`।

```text
You can only adjust inventory for your own branch
```

**দেখাবে:** [inventory.service.ts](../src/app/module/inventory/inventory.service.ts), `adjustInventory`-এর প্রথম branch check।

**বলবে:**

> একই manager অন্য branch-এর stock পরিবর্তনের চেষ্টা করলে 403 পাচ্ছেন। Role permission-এর পাশাপাশি branch-level authorization আছে।

### SR cannot create product

আগের valid product-create body দিয়ে:

```http
POST {{baseUrl}}/products
Authorization: Bearer {{srToken}}
```

Expected: `403 Forbidden`।

> SR authenticated হলেও product create করার permission নেই। তাই valid body পাঠিয়েও forbidden হচ্ছে।

## ৯. SR order ও manager approval — 5:00–6:00

আগে credit দেখাও:

```http
GET {{baseUrl}}/retailers/{{retailerId}}/credit-status
Authorization: Bearer {{srToken}}
```

> Order-এর payable amount retailer-এর available credit-এর মধ্যে থাকতে হবে।

Order create:

```http
POST {{baseUrl}}/orders
Authorization: Bearer {{srToken}}
```

```json
{
  "retailerId": "{{retailerId}}",
  "items": [
    {
      "productId": "{{productId}}",
      "quantity": 2
    }
  ],
  "discount": 0
}
```

Expected: `201 Created`। `data.id` → `orderId`। Response-এ `invoiceNo`, `payableAmount`, `items`, `status: PENDING` ও `paymentStatus: UNPAID` দেখাও।

**বলবে:**

> SR retailer-এর হয়ে order তৈরি করছেন। Request-এ product ID ও quantity পাঠাচ্ছি; price database থেকে আসছে। Branch authenticated SR থেকে নির্ধারণ হয়। Order সফল হলে stock কমে এবং retailer-এর due balance বাড়ে।

Manager approval:

```http
PATCH {{baseUrl}}/orders/{{orderId}}/status
Authorization: Bearer {{managerToken}}
```

```json
{
  "status": "APPROVED"
}
```

Expected: `200 OK`।

> নিজের branch-এর manager order approve করছেন। Status flow হচ্ছে Pending → Approved → Dispatched → Delivered। Allowed transition ছাড়া arbitrary status change করা যায় না।

সময় থাকলে একই PATCH request SR token দিয়ে চালিয়ে 403 দেখাবে।

## ১০. Validation ও errors — 6:00–6:40

```http
POST {{baseUrl}}/auth/login
```

```json
{
  "email": "invalid-email",
  "password": "Example123!"
}
```

Expected: `400 Bad Request`। মূল response:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "path": "email",
      "message": "Invalid email"
    }
  ]
}
```

Development mode-এ অতিরিক্ত `stack` থাকতে পারে।

**দেখাবে:** [auth.validation.ts](../src/app/module/auth/auth.validation.ts)-এর `loginSchema`, তারপর [globalErrorHandler.ts](../src/app/middleware/globalErrorHandler.ts)।

**বলবে:**

> Zod দিয়ে input validate করছি। Invalid email service-এ যাওয়ার আগেই reject হচ্ছে। Global error handler consistent JSON response দেয়, যেখানে কোন field invalid এবং কেন invalid বোঝা যায়।

401 demo:

```http
GET {{baseUrl}}/orders
```

Authorization → No Auth। `accessToken` cookie থাকলে clear করো। Expected: `401 Unauthorized`।

> 401 মানে valid authentication নেই। 403 মানে authenticated user-এর প্রয়োজনীয় permission নেই। Deleted product retrieve করার সময় 404 আগেই দেখিয়েছি।

## ১১. Payment flow — 6:40–8:25

### A. Session create

```http
POST {{baseUrl}}/payments/initiate
Authorization: Bearer {{srToken}}
```

```json
{
  "orderId": "{{orderId}}"
}
```

Expected: `200 OK`। Response shape; নিচের values placeholders:

```json
{
  "success": true,
  "message": "Payment initiated successfully",
  "data": {
    "paymentId": "local-database-payment-id",
    "paymentID": "bkash-gateway-payment-id",
    "bkashURL": "gateway-checkout-url"
  }
}
```

`data.paymentId` → `paymentId` variable।

**বলবে:**

> Backend order-এর outstanding amount হিসাব করে local payment reservation তৈরি করে। তারপর bKash checkout create করে URL return করে। paymentId আমাদের database ID, paymentID gateway reference। Amount client থেকে নিচ্ছি না।

### B. Checkout

Actual `bkashURL` browser-এ open করে sandbox payment complete করো।

> এই URL-এ customer payment complete করেন। এরপর browser configured callback URL-এ ফিরে আসে। এই backend callback JSON response দেয়; controller আলাদা success page render করে না।

### C. Verification

**দেখাবে:** [payment.service.ts](../src/app/module/payment/payment.service.ts), `handleCallback`। Gateway integration: [bkash.ts](../src/app/lib/bkash.ts)।

**বলবে:**

> Callback-এ success থাকলেই backend paid করে না। Success callback এলে execute API call করে; execute inconclusive হলে query API দিয়ে verify করে। Gateway-এর Completed status, matching payment ID, amount ও transaction ID যাচাইয়ের পরে database settle হয়।

### D. Updated status

```http
GET {{baseUrl}}/payments/{{paymentId}}
Authorization: Bearer {{srToken}}
```

```http
GET {{baseUrl}}/orders/{{orderId}}
Authorization: Bearer {{srToken}}
```

```http
GET {{baseUrl}}/retailers/{{retailerId}}/credit-status
Authorization: Bearer {{srToken}}
```

Successful settlement-এর পরে payment `PAID`, transaction ID, order paid amount ও payment status এবং retailer due balance দেখাও। Database viewer প্রস্তুত থাকলে `payments`, `orders`, `retailers` table-এ সংশ্লিষ্ট record filter করে দেখাতে পারো।

**বলবে:**

> Verified payment-এর পরে payment status paid হয়েছে, order paid amount বেড়েছে এবং retailer due balance কমেছে। এই database updates একই transaction-এ হয়। Delivery status এবং payment status আলাদা।

### E. Cancel handling

আগে প্রস্তুত করা দ্বিতীয় unpaid order-এর checkout খুলে Cancel করো। Paid order পুনরায় initiate করবে না।

**বলবে:**

> এটি আগে তৈরি করা আরেকটি unpaid order। Cancel callback-এর ক্ষেত্রেও backend gateway query করে। Gateway Cancelled, Failed বা Expired confirm করলে local payment FAILED হয়। Status final না হলে pending reservation রাখা হয় এবং reconciliation প্রয়োজন হয়। শুধু browser parameter দেখে financial state পরিবর্তন করি না।

**Demo সততা:** নিজে `status=success` লিখে callback hit করাকে successful payment বলবে না। Actual gateway confirmation দরকার। Sandbox কাজ না করলে code explain করা যাবে, কিন্তু live payment requirement পূরণ হয়েছে বলা যাবে না।

## ১২. Technical challenge — 8:25–9:25

**দেখাবে:** [order.service.ts](../src/app/module/order/order.service.ts), `createOrder`-এর transaction, credit reservation ও stock update।

```ts
const updateResult = await tx.branchInventory.updateMany({
  where: {
    branchId,
    productId: item.productId,
    stock: { gte: item.quantity }
  },
  data: { stock: { decrement: item.quantity } }
});
```

**বলবে:**

> একটি গুরুত্বপূর্ণ technical challenge ছিল concurrent order-এর সময় stock ও credit consistent রাখা। ধরুন stock পাঁচটি। একই সময়ে দুইজন SR পাঁচটি করে order দিলেন। শুধু stock read করে পরে update করলে দুজনই পাঁচটি stock দেখে order accept করতে পারেন।
>
> এটা এড়াতে conditional database update করেছি। Stock quantity-এর সমান বা বেশি হলেই একই operation-এ decrement হবে। Update count zero হলে insufficient stock error দিই। Credit reservation-এও condition check ও due balance increment এক operation-এ হচ্ছে।
>
> Credit reservation, stock deduction, order creation এবং audit log একই Prisma transaction-এ আছে। কোনো step fail করলে আগের changes rollback হয়। তাই শুধু transaction ব্যবহার করিনি; concurrent request-এর জন্য conditional update-ও ব্যবহার করেছি। টাকার calculation-এ Prisma Decimal ব্যবহার করেছি।

## ১৩. Testing, deployment ও সমাপ্তি — 9:25–10:00

**দেখাবে:** [regressions.test.ts](../tests/regressions.test.ts), নিজের actual test/build output।

```powershell
npm test
npm run build
```

**বলবে:**

> Critical behavior-এর regression tests আছে। যেমন revoked token reject করা, inventory adjustment, order decimal calculation ও invalid input। এই suite-এ database ও gateway mock করা আছে, তাই actual integration Postman ও sandbox দিয়েও verify করতে হয়।

Run না করে tests passed বলবে না।

**দেখাবে:** [render.yaml](../render.yaml)। Deployed থাকলে live API-এর একটি GET response দেখাও।

> Deployment configuration render.yaml-এ আছে। Environment variables দিয়ে database ও external service credentials configure করা হয়।

Deploy না থাকলে বলবে: “Deployment configuration প্রস্তুত আছে।”

**শেষ বক্তব্য:**

> এই project-এ distributor-এর business problem থেকে database relation, API design, authentication, role permission, credit-based ordering, validation ও verified payment flow implement করেছি। ধন্যবাদ।

## ১৪. Viva প্রশ্ন ও উত্তর

| প্রশ্ন | সংক্ষিপ্ত উত্তর |
|---|---|
| Controller ও service আলাদা কেন? | Controller HTTP request-response handle করে; service business rules ও database operations handle করে। |
| Authentication বনাম authorization? | প্রথমটি user কে যাচাই করে; দ্বিতীয়টি কোন কাজ করতে পারবে যাচাই করে। |
| Admin কি order create করতে পারে? | বর্তমান POST /orders শুধু FIELD_SR-এর workflow; admin-এর blanket role bypass নেই। |
| Manager-এর সব resource branch-scoped? | Inventory ও order-এর মতো scoped operations-এ branch restriction আছে; সব resource সম্পর্কে একই দাবি করা ঠিক নয়। |
| Retailer সরাসরি branch-linked? | বর্তমান Retailer model-এ branchId নেই; Order-এর মাধ্যমে branch activity যুক্ত হয়। |
| Price body থেকে নাও না কেন? | Client price manipulation আটকাতে database-এর product price ব্যবহার করি। |
| Transaction থাকলেই concurrency safe? | সব ক্ষেত্রে নয়; read-check-write race এড়াতে conditional update বা প্রয়োজনমতো row lock লাগে। |
| Decimal কেন? | Monetary storage ও calculation-এ decimal precision রাখার জন্য। |
| Soft delete কেন? | Historical reference রেখে normal queries থেকে resource বাদ দিতে। |
| Duplicate callback এলে? | Settlement-এ order lock ও current payment status recheck হয়; paid payment আবার ledger update করে না। |
| Payment paid মানেই delivered? | না; payment status এবং delivery status আলাদা। |
| Redis কেন? | Product cache, bKash token cache, OTP/pending registration ও rate-limit counters-এর জন্য। |
| Product cache TTL? | ৩০০ সেকেন্ড; product mutation-এর পরে invalidation আছে। |
| Cloudinary কী করে? | Product/profile image upload; database-এ secure URL ও public ID রাখা হয়। |
| Public registration আছে? | Staff registration admin/manager-authorized; OTP verification-এর পরে account তৈরি হয়। |
| Future improvement? | Batch/expiry tracking, stock movement history এবং automated pending-payment reconciliation। |

## ১৫. File navigation cheat sheet

| ব্যাখ্যার বিষয় | File / function |
|---|---|
| App middleware ও routes | `src/app.ts` |
| Startup | `src/server.ts` |
| Environment validation | `src/app/config/index.ts` |
| Prisma client | `src/app/lib/prisma.ts` |
| Authentication ও permission | `src/app/middleware/checkAuth.ts` → `auth` |
| Input validation | `src/app/module/auth/auth.validation.ts` → `loginSchema` |
| Central error response | `src/app/middleware/globalErrorHandler.ts` |
| CRUD route/controller/service | `src/app/module/product/product.*.ts` |
| Branch authorization | `src/app/module/inventory/inventory.service.ts` → `adjustInventory` |
| Order transaction | `src/app/module/order/order.service.ts` → `createOrder` |
| Order state machine | `src/app/module/order/order.interface.ts` → `ORDER_STATUS_TRANSITIONS` |
| Payment reservation/settlement | `src/app/module/payment/payment.service.ts` |
| Gateway calls | `src/app/lib/bkash.ts` |
| Order row lock | `src/app/utils/orderLock.ts` |
| Image upload | `src/app/lib/cloudinary.ts` |
| Models ও relations | `prisma/schema/` |
| Regression tests | `tests/regressions.test.ts` |
| Deployment | `render.yaml` |

## ১৬. Recording শেষ করার checklist

- [ ] Problem এবং architecture explain করেছি।
- [ ] তিন role দিয়ে actual API requests দেখিয়েছি।
- [ ] Forbidden role ও cross-branch request-এ 403 দেখিয়েছি।
- [ ] POST, GET, PATCH ও DELETE দেখিয়েছি।
- [ ] Validation error, 401 ও 404 দেখিয়েছি।
- [ ] Actual sandbox payment create → checkout → verification → database status দেখিয়েছি।
- [ ] Cancel handling দেখিয়েছি।
- [ ] Transaction ও concurrency challenge বুঝিয়ে বলেছি।
- [ ] Actual test/build result ও deployment-এর বর্তমান অবস্থা সঠিকভাবে বলেছি।
- [ ] Video ৫–১০ মিনিটের মধ্যে রেখেছি।
- [ ] Loom link অথবা Google Drive link submit করেছি; Drive হলে Anyone with the link → Viewer দিয়েছি।

প্রতিটি API demo-তে method ও URL → role/token selection → body → response status ও গুরুত্বপূর্ণ data দেখাবে।
