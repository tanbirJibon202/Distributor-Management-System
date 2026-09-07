import { OrderStatus, PaymentStatus, Role } from '../../generated/prisma/client.js';
import bcrypt from 'bcryptjs';
import config from '../config/index.js';
import { prisma } from '../lib/prisma.js';

const BCRYPT_ROUNDS = 12;

// Every seed step is an upsert keyed on a unique column, so running these on
// each boot is safe — an existing database is left exactly as it was.
export const seedSuperAdmin = async () => {
  try {
    const isSuperAdminExist = await prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN },
    });

    if (isSuperAdminExist) {
      console.log('Super Admin Already Exists!');
      return;
    }

    const hashedPassword = await bcrypt.hash(config.super_admin_password, BCRYPT_ROUNDS);

    const superAdmin = await prisma.user.create({
      data: {
        name: config.super_admin_name,
        email: config.super_admin_email,
        password: hashedPassword,
        role: Role.SUPER_ADMIN,
        branchId: null,
      },
    });

    console.log('Super Admin Created : ', superAdmin.email);
  } catch (error) {
    console.log('Error Seeding Super Admin : ', error);
  }
};

export const seedDemoData = async () => {
  if (config.node_env !== 'development') return;
  try {
    const dhaka = await prisma.branch.upsert({
      where: { code: 'DHK-01' },
      update: {},
      create: { name: 'Dhaka Central', code: 'DHK-01', type: 'CENTRAL', location: 'Dhaka' },
    });

    const chattogram = await prisma.branch.upsert({
      where: { code: 'CTG-01' },
      update: {},
      create: { name: 'Chattogram Branch', code: 'CTG-01', type: 'BRANCH', location: 'Chattogram' },
    });

    const managerPassword = await bcrypt.hash('Manager123!', BCRYPT_ROUNDS);
    await prisma.user.upsert({
      where: { email: 'manager.dhaka@dms.com' },
      update: {},
      create: {
        name: 'Dhaka Manager',
        email: 'manager.dhaka@dms.com',
        password: managerPassword,
        role: Role.BRANCH_MANAGER,
        branchId: dhaka.id,
      },
    });

    await prisma.user.upsert({
      where: { email: 'manager.ctg@dms.com' },
      update: {},
      create: {
        name: 'Chattogram Manager',
        email: 'manager.ctg@dms.com',
        password: managerPassword,
        role: Role.BRANCH_MANAGER,
        branchId: chattogram.id,
      },
    });

    const srPassword = await bcrypt.hash('FieldSr123!', BCRYPT_ROUNDS);
    const srData = [
      { name: 'SR One', email: 'sr1@dms.com', branchId: dhaka.id },
      { name: 'SR Two', email: 'sr2@dms.com', branchId: dhaka.id },
      { name: 'SR Three', email: 'sr3@dms.com', branchId: chattogram.id },
    ];

    const srs = [];
    for (const sr of srData) {
      srs.push(
        await prisma.user.upsert({
          where: { email: sr.email },
          update: {},
          create: { ...sr, password: srPassword, role: Role.FIELD_SR },
        }),
      );
    }

    const productData = [
      {
        name: 'Lux Soap 100g',
        sku: 'SKU-001',
        category: 'Toiletries',
        unit: 'PCS',
        price: 35,
        costPrice: 28,
      },
      {
        name: 'Lifebuoy Soap 100g',
        sku: 'SKU-002',
        category: 'Toiletries',
        unit: 'PCS',
        price: 32,
        costPrice: 26,
      },
      {
        name: 'Close Up Toothpaste 100g',
        sku: 'SKU-003',
        category: 'Toiletries',
        unit: 'PCS',
        price: 60,
        costPrice: 48,
      },
      {
        name: 'Fresh Milk Powder 1kg',
        sku: 'SKU-004',
        category: 'Dairy',
        unit: 'KG',
        price: 650,
        costPrice: 580,
      },
      {
        name: 'Rupchanda Soybean Oil 5L',
        sku: 'SKU-005',
        category: 'Grocery',
        unit: 'CTN',
        price: 850,
        costPrice: 780,
      },
      {
        name: 'Fresh Salt 1kg',
        sku: 'SKU-006',
        category: 'Grocery',
        unit: 'KG',
        price: 40,
        costPrice: 32,
      },
      {
        name: 'Pran Mustard Oil 1L',
        sku: 'SKU-007',
        category: 'Grocery',
        unit: 'PCS',
        price: 210,
        costPrice: 185,
      },
      {
        name: 'Tibet Fair Cream 50g',
        sku: 'SKU-008',
        category: 'Cosmetics',
        unit: 'PCS',
        price: 55,
        costPrice: 42,
      },
      {
        name: 'Marks Biscuit 200g',
        sku: 'SKU-009',
        category: 'Snacks',
        unit: 'CTN',
        price: 45,
        costPrice: 36,
      },
      {
        name: 'Ispahani Tea 400g',
        sku: 'SKU-010',
        category: 'Grocery',
        unit: 'PCS',
        price: 280,
        costPrice: 240,
      },
      {
        name: 'Square Napkin Pack',
        sku: 'SKU-011',
        category: 'Toiletries',
        unit: 'PCS',
        price: 25,
        costPrice: 18,
      },
      {
        name: 'ACI Aerosol 300ml',
        sku: 'SKU-012',
        category: 'Household',
        unit: 'PCS',
        price: 320,
        costPrice: 275,
      },
    ];

    const products = [];
    for (const p of productData) {
      products.push(await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p }));
    }

    for (const branch of [dhaka, chattogram]) {
      for (const product of products) {
        await prisma.branchInventory.upsert({
          where: { branchId_productId: { branchId: branch.id, productId: product.id } },
          update: {},
          create: { branchId: branch.id, productId: product.id, stock: 500 },
        });
      }
    }

    // `Rahim General Store` is seeded close to its credit limit on purpose, so
    // the credit-limit block can be demonstrated without setting anything up.
    const retailerData = [
      {
        shopName: 'Karim Store',
        ownerName: 'Karim Uddin',
        phone: '01710000001',
        address: 'Mirpur, Dhaka',
        routeArea: 'Mirpur',
        creditLimit: 50000,
        dueBalance: 0,
      },
      {
        shopName: 'Rahim General Store',
        ownerName: 'Abdur Rahim',
        phone: '01710000002',
        address: 'Mohammadpur, Dhaka',
        routeArea: 'Mohammadpur',
        creditLimit: 40000,
        dueBalance: 38500,
      },
      {
        shopName: 'Nabi Bhandar',
        ownerName: 'Nabi Hossain',
        phone: '01710000003',
        address: 'Gulshan, Dhaka',
        routeArea: 'Gulshan',
        creditLimit: 100000,
        dueBalance: 25000,
      },
      {
        shopName: 'Anowar Store',
        ownerName: 'Anowar Islam',
        phone: '01710000004',
        address: 'Agrabad, Chattogram',
        routeArea: 'Agrabad',
        creditLimit: 60000,
        dueBalance: 12000,
      },
      {
        shopName: 'City Traders',
        ownerName: 'Jashim Uddin',
        phone: '01710000005',
        address: 'GEC, Chattogram',
        routeArea: 'GEC',
        creditLimit: 75000,
        dueBalance: 0,
      },
      {
        shopName: 'Momin Store',
        ownerName: 'Momin Ahmed',
        phone: '01710000006',
        address: 'Panchlaish, Chattogram',
        routeArea: 'Panchlaish',
        creditLimit: 30000,
        dueBalance: 5000,
      },
    ];

    const retailers = [];
    for (const r of retailerData) {
      retailers.push(
        await prisma.retailer.upsert({ where: { phone: r.phone }, update: {}, create: r }),
      );
    }

    const existingOrder = await prisma.order.findUnique({ where: { invoiceNo: 'INV-SEED-0001' } });
    if (!existingOrder) {
      const quantity = 10;
      const seedOrders = [
        {
          invoiceNo: 'INV-SEED-0001',
          branchId: dhaka.id,
          srId: srs[0].id,
          retailerId: retailers[0].id,
          product: products[0],
          status: OrderStatus.DELIVERED,
          paymentStatus: PaymentStatus.PAID,
          paid: true,
        },
        {
          invoiceNo: 'INV-SEED-0002',
          branchId: dhaka.id,
          srId: srs[1].id,
          retailerId: retailers[1].id,
          product: products[1],
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.UNPAID,
          paid: false,
        },
        {
          invoiceNo: 'INV-SEED-0003',
          branchId: chattogram.id,
          srId: srs[2].id,
          retailerId: retailers[3].id,
          product: products[2],
          status: OrderStatus.APPROVED,
          paymentStatus: PaymentStatus.UNPAID,
          paid: false,
        },
      ];

      for (const o of seedOrders) {
        const unitPrice = Number(o.product.price);
        const subTotal = unitPrice * quantity;

        await prisma.order.create({
          data: {
            invoiceNo: o.invoiceNo,
            branchId: o.branchId,
            srId: o.srId,
            retailerId: o.retailerId,
            totalAmount: subTotal,
            discount: 0,
            payableAmount: subTotal,
            paidAmount: o.paid ? subTotal : 0,
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            status: o.status,
            paymentStatus: o.paymentStatus,
            items: { create: [{ productId: o.product.id, quantity, unitPrice, subTotal }] },
          },
        });
      }
    }

    console.log('Demo Data Seeded Successfully.');
  } catch (error) {
    console.log('Error Seeding Demo Data : ', error);
  }
};
