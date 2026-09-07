import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import type { Server } from 'node:http';
process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'regression-test-client';
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASSWORD = 'test';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
process.env.JWT_ACCESS_SECRET = 'regression-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'regression-test-refresh-secret';
const { prisma } = await import('../src/app/lib/prisma.js');
const { Prisma } = await import('../src/generated/prisma/client.js');
const { BkashClient } = await import('../src/app/lib/bkash.js');
const { PaymentService } = await import('../src/app/module/payment/payment.service.js');
const { OrderService } = await import('../src/app/module/order/order.service.js');
const { signAccessToken } = await import('../src/app/utils/jwt.js');
const { seedDemoData } = await import('../src/app/utils/seed.js');
const { default: config } = await import('../src/app/config/index.js');
const { default: app } = await import('../src/app.js');

const orderId = '11111111-1111-4111-8111-111111111111';
const paymentId = '22222222-2222-4222-8222-222222222222';
const actor = {
  userId: '33333333-3333-4333-8333-333333333333',
  role: 'FIELD_SR',
  branchId: 'branch-a',
};
const admin = { ...actor, role: 'SUPER_ADMIN', branchId: null };
const manager = { ...actor, role: 'BRANCH_MANAGER' };
const decimal = (n: number) => new Prisma.Decimal(n);
let server: Server;
let baseUrl: string;
before(async () => {
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await prisma.$disconnect();
});
const restorations: Array<() => void> = [];
function stub(target: any, key: string, implementation: any) {
  const original = target[key];
  const replacement = mock.fn(implementation);
  target[key] = replacement;
  restorations.push(() => {
    target[key] = original;
  });
  return replacement;
}
function restore() {
  for (const reset of restorations.splice(0).reverse()) reset();
  mock.restoreAll();
}
afterEach(restore);

const account = (role = 'SUPER_ADMIN') => {
  stub(prisma.user, 'findFirst', async () => ({
    id: actor.userId,
    email: 'test@example.com',
    tokenVersion: 0,
    role,
    branchId: actor.branchId,
  }));
};
const request = (path: string, role = 'SUPER_ADMIN', method = 'GET') =>
  fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${signAccessToken({ ...actor, role: role as 'SUPER_ADMIN', email: 'test@example.com' })}`,
    },
  });

test('demoted admin token cannot reach an admin route; promoted account uses its current role', async () => {
  account('FIELD_SR');
  const fetchUsers = stub(prisma.user, 'findMany', async () => []);
  stub(prisma.user, 'count', async () => 0);
  const denied = await request('/admin/users');
  assert.equal(denied.status, 403);
  assert.equal(fetchUsers.mock.callCount(), 0);
  restore();
  account('SUPER_ADMIN');
  stub(prisma.user, 'findMany', async () => []);
  stub(prisma.user, 'count', async () => 0);
  assert.equal((await request('/admin/users', 'FIELD_SR')).status, 200);
});

test('invalid list queries and resource IDs return structured 400 responses', async () => {
  account();
  for (const path of [
    '/products?sortBy=password',
    '/products?sortOrder=sideways',
    '/products?limit=101',
    '/products?page=1.5',
    '/products?page=Infinity',
    '/products?limit=0',
    '/products?search=a&search=b',
    '/products?minPrice=20&maxPrice=10',
    '/orders?status=UNKNOWN',
    '/admin/users?role=OWNER',
    '/inventory?lowStock=-1',
    '/retailers?sortBy=password',
    '/payments/not-a-uuid',
    '/orders/not-a-uuid',
    '/payments/callback?paymentID=abc&status=unknown',
  ]) {
    const response = await request(path);
    const body = await response.json();
    assert.equal(response.status, 400, path);
    assert.equal(body.success, false);
    assert.ok(Array.isArray(body.errors));
  }
});

// A small database double: $queryRaw acquires an order mutex, released at
// transaction end. Without the service's lock, concurrent reads both see the
// old state. This tests service behavior, not PostgreSQL lock implementation.
function database() {
  const order: any = {
    id: orderId,
    srId: actor.userId,
    branchId: actor.branchId,
    retailerId: 'retailer',
    invoiceNo: 'INV-TEST',
    status: 'PENDING',
    paymentStatus: 'UNPAID',
    payableAmount: decimal(100),
    paidAmount: decimal(0),
    items: [{ productId: 'product', quantity: 2 }],
  };
  const payments: any[] = [];
  const state = { stock: 8, due: 100, logs: [] as any[] };
  let tail = Promise.resolve();
  // Mirrors what updateOrderStatus actually selects, relations included, so
  // the fake cannot pass while the real query shape would fail.
  const readOrder = async () => ({
    ...order,
    payments: payments.map((p) => ({ ...p })),
    sr: { name: 'Field SR', email: 'sr@dms.test' },
    retailer: { shopName: 'Test Shop' },
  });
  const payment = {
    findFirst: async ({ where }: any) =>
      payments.find(
        (p) =>
          (!where.gatewayPaymentId || p.gatewayPaymentId === where.gatewayPaymentId) &&
          (!where.orderId || p.orderId === where.orderId) &&
          (!where.status || where.status.in.includes(p.status)),
      ) ?? null,
    findUnique: async ({ where }: any) => {
      const p = payments.find((p) => p.id === where.id);
      return p ? { ...p, order: { ...order } } : null;
    },
    findUniqueOrThrow: async ({ where }: any) => ({ ...payments.find((p) => p.id === where.id) }),
    create: async ({ data }: any) => {
      const p = { ...data, id: paymentId, gatewayPaymentId: null };
      payments.push(p);
      return { ...p };
    },
    update: async ({ where, data }: any) =>
      Object.assign(
        payments.find((p) => p.id === where.id),
        data,
      ),
    updateMany: async ({ where, data }: any) => {
      const p = payments.find(
        (p) =>
          p.id === where.id &&
          (where.gatewayPaymentId === undefined || p.gatewayPaymentId === where.gatewayPaymentId) &&
          (!where.status ||
            (typeof where.status === 'string'
              ? p.status === where.status
              : p.status !== where.status.not)),
      );
      if (!p) return { count: 0 };
      Object.assign(p, data);
      return { count: 1 };
    },
  };
  const orderDelegate = {
    findUnique: readOrder,
    findUniqueOrThrow: readOrder,
    update: async ({ data }: any) => {
      Object.assign(order, data);
      return { ...order };
    },
  };
  const delegates = {
    payment,
    order: orderDelegate,
    retailer: {
      update: async ({ data }: any) => {
        state.due -= Number(data.dueBalance.decrement);
        return {};
      },
    },
    branchInventory: {
      upsert: async ({ update }: any) => {
        state.stock += update.stock.increment;
        return {};
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        state.logs.push(data);
        return data;
      },
    },
  };
  for (const [name, delegate] of Object.entries({ payment, order: orderDelegate })) {
    for (const [method, implementation] of Object.entries(delegate)) {
      stub((prisma as any)[name], method, implementation);
    }
  }
  stub(prisma, '$transaction', async (fn: any) => {
    let release: (() => void) | undefined;
    try {
      return await fn({
        ...delegates,
        $queryRaw: async () => {
          const previous = tail;
          tail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          return [{ id: orderId }];
        },
      });
    } finally {
      release?.();
    }
  });
  const addPayment = () =>
    payments.push({
      id: paymentId,
      orderId,
      amount: decimal(100),
      status: 'UNPAID',
      provider: 'BKASH',
      gatewayPaymentId: 'gateway-1',
    });
  return { order, payments, state, addPayment };
}
const completed = {
  paymentID: 'gateway-1',
  transactionStatus: 'Completed',
  trxID: 'trx-1',
  amount: '100.00',
};

test('payment reads and initiation enforce SR and branch ownership before contacting gateway', async () => {
  const db = database();
  db.addPayment();
  const create = stub(BkashClient, 'createPayment', async () => {
    throw new Error('must not call');
  });
  for (const outsider of [
    { ...actor, userId: 'other-sr' },
    { ...manager, branchId: 'branch-b' },
  ]) {
    await assert.rejects(PaymentService.getPaymentById(outsider, paymentId), { statusCode: 403 });
    await assert.rejects(PaymentService.initiatePayment(outsider, orderId), { statusCode: 403 });
  }
  assert.equal(create.mock.callCount(), 0);
  assert.equal((await PaymentService.getPaymentById(actor, paymentId)).id, paymentId);
  assert.equal((await PaymentService.getPaymentById(manager, paymentId)).id, paymentId);
  assert.equal((await PaymentService.getPaymentById(admin, paymentId)).id, paymentId);
});

test('concurrent cancellation restores stock and reverses credit exactly once', async () => {
  const db = database();
  const outcomes = await Promise.allSettled([
    OrderService.updateOrderStatus(manager, orderId, 'CANCELLED'),
    OrderService.updateOrderStatus(manager, orderId, 'CANCELLED'),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.state.stock, 10);
  assert.equal(db.state.due, 0);
  assert.equal(db.state.logs.length, 1);
});

test('concurrent payment initiation creates only one gateway checkout', async () => {
  const db = database();
  const create = stub(BkashClient, 'createPayment', async () => ({
    paymentID: 'gateway-1',
    bkashURL: 'https://example.com/pay',
  }));
  const outcomes = await Promise.allSettled([
    PaymentService.initiatePayment(actor, orderId),
    PaymentService.initiatePayment(actor, orderId),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(db.payments.length, 1);
});

test('cancelled orders cannot initiate payment; active checkouts prevent cancellation', async () => {
  const db = database();
  db.order.status = 'CANCELLED';
  await assert.rejects(PaymentService.initiatePayment(actor, orderId), { statusCode: 400 });
  db.order.status = 'PENDING';
  db.addPayment();
  await assert.rejects(OrderService.updateOrderStatus(manager, orderId, 'CANCELLED'), {
    statusCode: 409,
  });
  assert.equal(db.state.stock, 8);
  assert.equal(db.state.due, 100);
});

test('concurrent successful callbacks settle one payment exactly once', async () => {
  const db = database();
  db.addPayment();
  stub(BkashClient, 'executePayment', async () => ({ ...completed }));
  await Promise.all([
    PaymentService.handleCallback('gateway-1', 'success'),
    PaymentService.handleCallback('gateway-1', 'success'),
  ]);
  assert.equal(Number(db.order.paidAmount), 100);
  assert.equal(db.state.due, 0);
  assert.equal(db.state.logs.filter((l) => l.action === 'PAYMENT_SUCCESS').length, 1);
});

test('untrusted failure callback cannot release a pending payment', async () => {
  const db = database();
  db.addPayment();
  stub(BkashClient, 'queryPayment', async () => ({
    paymentID: 'gateway-1',
    transactionStatus: 'Initiated',
  }));
  await assert.rejects(PaymentService.handleCallback('gateway-1', 'cancel'), { statusCode: 409 });
  assert.equal(db.payments[0].status, 'UNPAID');
  assert.equal(db.state.due, 100);
});

test('execute timeout is reconciled with gateway query; later failure cannot downgrade paid state', async () => {
  const db = database();
  db.addPayment();
  stub(BkashClient, 'executePayment', async () => {
    throw new Error('timeout');
  });
  stub(BkashClient, 'queryPayment', async () => ({ ...completed }));
  await PaymentService.handleCallback('gateway-1', 'success');
  await PaymentService.handleCallback('gateway-1', 'failure');
  assert.equal(db.payments[0].status, 'PAID');
  assert.equal(Number(db.order.paidAmount), 100);
  assert.equal(db.state.due, 0);
});

test('mismatched amounts and overpayments do not change ledger or release checkout', async () => {
  const db = database();
  db.addPayment();
  const execute = stub(BkashClient, 'executePayment', async () => ({
    ...completed,
    amount: '99.00',
  }));
  await assert.rejects(PaymentService.handleCallback('gateway-1', 'success'), { statusCode: 400 });
  assert.equal(db.payments[0].status, 'UNPAID');
  execute.mock.mockImplementation(async () => ({ ...completed }));
  db.order.paidAmount = decimal(50);
  await assert.rejects(PaymentService.handleCallback('gateway-1', 'success'), { statusCode: 409 });
  assert.equal(db.state.due, 100);
  assert.equal(Number(db.order.paidAmount), 50);
});

test('gateway-confirmed cancellation releases pending payment with audit log', async () => {
  const db = database();
  db.addPayment();
  stub(BkashClient, 'queryPayment', async () => ({
    paymentID: 'gateway-1',
    transactionStatus: 'Cancelled',
  }));
  await PaymentService.handleCallback('gateway-1', 'cancel');
  assert.equal(db.payments[0].status, 'FAILED');
  await OrderService.updateOrderStatus(manager, orderId, 'CANCELLED');
  assert.equal(db.state.due, 0);
  assert.equal(db.state.stock, 10);
});

test('production demo seeding performs no database writes', async () => {
  const previous = config.node_env;
  config.node_env = 'production';
  const seed = stub(prisma.branch, 'upsert', async () => {
    throw new Error('must not write');
  });
  try {
    await seedDemoData();
    assert.equal(seed.mock.callCount(), 0);
  } finally {
    config.node_env = previous;
  }
});

test('payment initiation racing cancellation cannot leave a payable cancelled order', async () => {
  const db = database();
  const create = stub(BkashClient, 'createPayment', async () => ({
    paymentID: 'gateway-1',
    bkashURL: 'https://example.com/pay',
  }));
  const results = await Promise.allSettled([
    OrderService.updateOrderStatus(manager, orderId, 'CANCELLED'),
    PaymentService.initiatePayment(actor, orderId),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.order.status, 'CANCELLED');
  assert.equal(create.mock.callCount(), 0);
  assert.equal(db.payments.length, 0);
});

test('payment settlement racing cancellation changes credit only once', async () => {
  const db = database();
  db.addPayment();
  stub(BkashClient, 'executePayment', async () => ({ ...completed }));
  const results = await Promise.allSettled([
    PaymentService.handleCallback('gateway-1', 'success'),
    OrderService.updateOrderStatus(manager, orderId, 'CANCELLED'),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(db.order.status, 'PENDING');
  assert.equal(db.state.stock, 8);
  assert.equal(db.state.due, 0);
});

test('gateway create failure releases an unexposed reservation for retry', async () => {
  const db = database();
  stub(BkashClient, 'createPayment', async () => {
    throw new Error('gateway unavailable');
  });
  await assert.rejects(PaymentService.initiatePayment(actor, orderId), /gateway unavailable/);
  assert.equal(db.payments[0].status, 'FAILED');
  assert.equal(db.state.due, 100);
  assert.equal(db.state.stock, 8);
});

test('uncertain gateway status keeps the reservation pending', async () => {
  const db = database();
  db.addPayment();
  stub(BkashClient, 'executePayment', async () => {
    throw new Error('timeout');
  });
  stub(BkashClient, 'queryPayment', async () => {
    throw new Error('query timeout');
  });
  await assert.rejects(PaymentService.handleCallback('gateway-1', 'success'), /query timeout/);
  assert.equal(db.payments[0].status, 'UNPAID');
  assert.equal(Number(db.order.paidAmount), 0);
  assert.equal(db.state.due, 100);
});

const { AuthService } = await import('../src/app/module/auth/auth.service.js');
const { InventoryService } = await import('../src/app/module/inventory/inventory.service.js');
const { UserService } = await import('../src/app/module/user/user.service.js');
const { RetailerService } = await import('../src/app/module/retailer/retailer.service.js');
const { OrderValidation } = await import('../src/app/module/order/order.validation.js');
const { googleClient } = await import('../src/app/lib/googleAuth.js');
const { redisClient } = await import('../src/app/lib/redis.js');
const { signRefreshToken } = await import('../src/app/utils/jwt.js');
const { default: nodemailer } = await import('nodemailer');

const registration = {
  name: 'SR',
  email: 'sr@example.com',
  password: 'ValidPassword123!',
  branchId: actor.branchId,
};
const staff = { ...actor, email: 'staff@example.com' };

test('staff registration rejects public callers, SRs and managers of another branch', async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registration),
  });
  assert.equal(response.status, 401);
  await assert.rejects(AuthService.registerUser(staff as any, registration as any), {
    statusCode: 403,
  });
  await assert.rejects(
    AuthService.registerUser(
      { ...staff, role: 'BRANCH_MANAGER', branchId: 'other' } as any,
      registration as any,
    ),
    { statusCode: 403 },
  );
});

test('approved registration stages the authorizing manager; only OTP verification creates the account', async () => {
  const records = new Map<string, string>();
  stub(prisma.branch, 'findFirst', async () => ({ id: actor.branchId }));
  stub(prisma.user, 'findUnique', async () => null);
  stub(redisClient, 'set', async (key: string, value: string) => {
    records.set(key, value);
    return 'OK';
  });
  stub(redisClient, 'get', async (key: string) => records.get(key));
  stub(redisClient, 'del', async () => 1);
  stub(redisClient, 'eval', async () => 10);
  const multi = { set: () => multi, del: () => multi, exec: async () => [] };
  stub(redisClient, 'multi', () => multi);
  stub(nodemailer, 'createTransport', () => ({ sendMail: async () => ({}) }));
  const created = mock.fn(async ({ data }: any) => ({
    ...data,
    id: actor.userId,
    tokenVersion: 0,
  }));
  stub(prisma, '$transaction', async (fn: any) =>
    fn({
      user: {
        findFirst: async () => ({ role: 'BRANCH_MANAGER', branchId: actor.branchId }),
        create: created,
      },
      auditLog: { create: async () => ({}) },
    }),
  );
  await AuthService.registerUser({ ...staff, role: 'BRANCH_MANAGER' } as any, registration as any);
  assert.equal(created.mock.callCount(), 0);
  const staged = JSON.parse(records.get('registration:sr@example.com')!);
  assert.equal(staged.authorizedBy, actor.userId);
  assert.notEqual(staged.password, registration.password);
  const verified = await AuthService.verifyEmail({ email: registration.email, otp: '123456' });
  assert.equal(verified.user.role, 'FIELD_SR');
  assert.equal(verified.user.branchId, actor.branchId);
  assert.ok(verified.accessToken);
  assert.equal(created.mock.callCount(), 1);
});

test('registration cannot activate after the approving manager loses permission', async () => {
  stub(redisClient, 'get', async () =>
    JSON.stringify({ ...registration, authorizedBy: actor.userId }),
  );
  stub(redisClient, 'eval', async () => 10);
  stub(prisma.user, 'findUnique', async () => null);
  stub(prisma.branch, 'findFirst', async () => ({ id: actor.branchId }));
  const create = mock.fn();
  stub(prisma, '$transaction', async (fn: any) =>
    fn({ user: { findFirst: async () => ({ role: 'FIELD_SR' }), create } }),
  );
  await assert.rejects(AuthService.verifyEmail({ email: registration.email, otp: '123456' }), {
    statusCode: 403,
  });
  assert.equal(create.mock.callCount(), 0);
});

test('Google login rejects unknown staff and unverified email identities', async () => {
  const verify = stub(googleClient, 'verifyIdToken', async () => ({
    getPayload: () => ({ email: 'new@example.com', sub: 'google-id', email_verified: true }),
  }));
  stub(prisma.user, 'findFirst', async () => null);
  const create = stub(prisma.user, 'create', async () => {
    throw new Error('must not create');
  });
  await assert.rejects(AuthService.googleAuth('token'), { statusCode: 403 });
  verify.mock.mockImplementation(async () => ({
    getPayload: () => ({ email: 'new@example.com', sub: 'google-id', email_verified: false }),
  }));
  await assert.rejects(AuthService.googleAuth('token'), { statusCode: 401 });
  assert.equal(create.mock.callCount(), 0);
});

test('logout revokes copied access and refresh tokens', async () => {
  const user = {
    id: actor.userId,
    email: staff.email,
    role: 'FIELD_SR',
    branchId: actor.branchId,
    tokenVersion: 0,
  };
  stub(prisma.user, 'findFirst', async () => ({ ...user }));
  stub(prisma.user, 'update', async () => {
    user.tokenVersion++;
    return user;
  });
  const refresh = signRefreshToken({ ...staff, role: 'FIELD_SR', tokenVersion: 0 });
  const logout = await request('/auth/logout', 'FIELD_SR', 'POST');
  assert.equal(logout.status, 200);
  assert.equal((await request('/auth/me', 'FIELD_SR')).status, 401);
  await assert.rejects(AuthService.refreshAccessToken(refresh), { statusCode: 401 });
});

test('password reset increments the session version and invalidates old refresh tokens', async () => {
  const user = {
    id: actor.userId,
    email: staff.email,
    role: 'FIELD_SR',
    branchId: actor.branchId,
    tokenVersion: 0,
  };
  stub(prisma.user, 'findFirst', async () => ({ ...user }));
  stub(redisClient, 'eval', async () => 10);
  stub(prisma, '$transaction', async (fn: any) =>
    fn({
      user: {
        update: async ({ data }: any) => {
          assert.equal(data.tokenVersion.increment, 1);
          user.tokenVersion++;
          return user;
        },
      },
      auditLog: { create: async () => ({}) },
    }),
  );
  await AuthService.resetPassword({
    email: staff.email,
    otp: '123456',
    newPassword: 'NewPassword123!',
  });
  await assert.rejects(
    AuthService.refreshAccessToken(
      signRefreshToken({ ...staff, role: 'FIELD_SR', tokenVersion: 0 }),
    ),
    { statusCode: 401 },
  );
});

test('concurrent inventory adjustments retain both increments and cannot subtract below zero', async () => {
  let stock = 5;
  stub(prisma.branch, 'findFirst', async () => ({ id: actor.branchId }));
  stub(prisma.product, 'findFirst', async () => ({ id: 'product' }));
  const inventory = {
    findUnique: async () => ({ id: 'inventory', stock }),
    findUniqueOrThrow: async () => ({ id: 'inventory', stock }),
    upsert: async ({ update }: any) => {
      stock = typeof update.stock === 'number' ? update.stock : stock + update.stock.increment;
      return { id: 'inventory', stock };
    },
    updateMany: async ({ where, data }: any) => {
      if (stock < where.stock.gte) return { count: 0 };
      stock += data.stock.increment;
      return { count: 1 };
    },
  };
  stub(prisma, '$transaction', async (fn: any) =>
    fn({ branchInventory: inventory, auditLog: { create: async () => ({}) } }),
  );
  const input = {
    branchId: actor.branchId!,
    productId: 'product',
    reason: 'Stock count',
    quantity: 2,
  };
  await Promise.all([
    InventoryService.adjustInventory(manager, input),
    InventoryService.adjustInventory(manager, input),
  ]);
  assert.equal(stock, 9);
  const results = await Promise.allSettled([
    InventoryService.adjustInventory(manager, { ...input, quantity: -7 }),
    InventoryService.adjustInventory(manager, { ...input, quantity: -7 }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(stock, 2);
});

test('concurrent demotions cannot remove the final super-admin', async () => {
  const users = [
    { id: 'admin-a', role: 'SUPER_ADMIN', branchId: null },
    { id: 'admin-b', role: 'SUPER_ADMIN', branchId: null },
  ];
  let tail = Promise.resolve();
  stub(prisma, '$transaction', async (fn: any) => {
    let release: (() => void) | undefined;
    try {
      return await fn({
        $queryRaw: async () => {
          const previous = tail;
          tail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          return [];
        },
        user: {
          findFirst: async ({ where }: any) => ({ ...users.find((u) => u.id === where.id) }),
          count: async () => users.filter((u) => u.role === 'SUPER_ADMIN').length,
          update: async ({ where, data }: any) =>
            Object.assign(users.find((u) => u.id === where.id)!, data),
        },
        branch: { findFirst: async () => ({ id: actor.branchId }) },
        auditLog: { create: async () => ({}) },
      });
    } finally {
      release?.();
    }
  });
  const results = await Promise.allSettled(
    users.map((u) =>
      UserService.updateUserRole('admin-a', u.id, { role: 'FIELD_SR', branchId: actor.branchId }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(users.filter((u) => u.role === 'SUPER_ADMIN').length, 1);
});

test('retailer deletion rechecks outstanding credit after acquiring its row lock', async () => {
  let due = 0;
  const update = mock.fn();
  stub(prisma.retailer, 'findFirst', async () => ({ id: 'retailer', dueBalance: decimal(0) }));
  stub(prisma, '$transaction', async (fn: any) =>
    fn({
      $queryRaw: async () => {
        due = 100;
        return [];
      },
      retailer: { findFirst: async () => ({ id: 'retailer', dueBalance: decimal(due) }), update },
    }),
  );
  await assert.rejects(RetailerService.deleteRetailer(actor.userId, 'retailer'), {
    statusCode: 400,
  });
  assert.equal(update.mock.callCount(), 0);
});

test('order totals use exact decimals and reject zero-value orders', async () => {
  const tx = {
    retailer: {
      findFirst: async () => ({ creditLimit: decimal(100), dueBalance: decimal(0) }),
      updateMany: async () => ({ count: 1 }),
    },
    product: { findMany: async () => [{ id: 'product', name: 'Product', price: decimal(0.1) }] },
    branchInventory: { updateMany: async () => ({ count: 1 }) },
    order: {
      findUnique: async () => null,
      create: async ({ data }: any) => ({ ...data, id: orderId }),
    },
    auditLog: { create: async () => ({}) },
  };
  stub(prisma, '$transaction', async (fn: any) => fn(tx));
  const order = await OrderService.createOrder(actor, {
    retailerId: 'retailer',
    items: [{ productId: 'product', quantity: 3 }],
  });
  assert.equal(order.payableAmount.toString(), '0.3');
  assert.equal(order.totalAmount.toString(), '0.3');
  await assert.rejects(
    OrderService.createOrder(actor, {
      retailerId: 'retailer',
      items: [{ productId: 'product', quantity: 3 }],
      discount: 0.3,
    }),
    { statusCode: 400 },
  );
});

test('order validation rejects duplicate products and fractional cents', () => {
  const item = { productId: paymentId, quantity: 1 };
  assert.equal(
    OrderValidation.createOrderSchema.safeParse({
      body: { retailerId: orderId, items: [item, item] },
    }).success,
    false,
  );
  assert.equal(
    OrderValidation.createOrderSchema.safeParse({
      body: { retailerId: orderId, items: [item], discount: 0.001 },
    }).success,
    false,
  );
});

test('Google login accepts a matching approved staff identity without exposing password or session version', async () => {
  stub(googleClient, 'verifyIdToken', async () => ({
    getPayload: () => ({ email: staff.email, sub: 'linked-google-id', email_verified: true }),
  }));
  stub(prisma.user, 'findFirst', async () => ({
    id: actor.userId,
    email: staff.email,
    role: 'FIELD_SR',
    branchId: actor.branchId,
    googleId: 'linked-google-id',
    password: 'password-hash',
    tokenVersion: 0,
  }));
  const result = await AuthService.googleAuth('token');
  assert.ok(result.accessToken);
  assert.equal('password' in result.user, false);
  assert.equal('tokenVersion' in result.user, false);
});
