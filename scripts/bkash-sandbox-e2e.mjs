import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';

dotenv.config();
const endpoint = new URL(process.env.BKASH_BASE_URL);
assert.equal(endpoint.hostname, 'tokenized.sandbox.bka.sh', 'This runner only allows the real bKash sandbox');
assert.equal(endpoint.protocol, 'https:');
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
const { default: app } = await import('../src/app.js');
const { default: config } = await import('../src/app/config/index.js');
const { prisma } = await import('../src/app/lib/prisma.js');
const { BkashClient } = await import('../src/app/lib/bkash.js');
const runId = crypto.randomUUID();
const ids = Object.fromEntries(['branch','user','product','retailer'].map(key => [key, crypto.randomUUID()]));
const report = { runId, startedAt: new Date().toISOString(), environment: 'bKash sandbox',
  testDataSource: 'https://merchantdemo.sandbox.bka.sh/tokenized-checkout/version/v1.2.0-beta', checks: [], fixtures: ids };
fs.mkdirSync('.sandbox-artifacts', { recursive: true });
let server, browser, page, token, base, current;
const orders = [];
let created = false;
const safeError = error => {
  let message = error.message ?? String(error);
  for (const key of ['DATABASE_URL','DIRECT_URL','BKASH_USERNAME','BKASH_PASSWORD','BKASH_APP_KEY','BKASH_APP_SECRET']) {
    if (process.env[key]) message = message.split(process.env[key]).join('[redacted]');
  }
  return message.replace(/https?:\/\/[^\s"']+/g, '[URL]').slice(0, 1200);
};
const save = () => fs.writeFileSync('docs/bkash-sandbox-verification.json', JSON.stringify(report, null, 2)+'\n');
async function api(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base+path, { method, signal: AbortSignal.timeout(100000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json();
  if (!response.ok) throw new Error(`API ${path.split('?')[0]}: ${response.status} ${json.message}`);
  return json.data;
}
async function snapshot() {
  const [order, payment, retailer, inventory, auditCount] = await Promise.all([
    prisma.order.findUniqueOrThrow({ where: { id: current.orderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: current.paymentId } }),
    prisma.retailer.findUniqueOrThrow({ where: { id: ids.retailer } }),
    prisma.branchInventory.findUniqueOrThrow({ where: { branchId_productId: { branchId: ids.branch, productId: ids.product } } }),
    prisma.auditLog.count({ where: { entityId: current.orderId, action: 'PAYMENT_SUCCESS' } }),
  ]);
  return { orderId: order.id, paymentId: payment.id, orderStatus: order.status,
    paymentStatus: payment.status, orderPaymentStatus: order.paymentStatus, payableAmount: order.payableAmount.toString(),
    paidAmount: order.paidAmount.toString(), retailerDue: retailer.dueBalance.toString(), stock: inventory.stock,
    transactionId: payment.transactionId, paymentSuccessAuditCount: auditCount };
}
async function inspect() {
  await page.waitForTimeout(800);
  const dom = await page.evaluate(() => ({
    title: document.title,
    inputs: [...document.querySelectorAll('input')].filter(e=>e.getBoundingClientRect().height>0).map(e=>({id:e.id,name:e.name,type:e.type,placeholder:e.placeholder})),
    buttons: [...document.querySelectorAll('button,input[type=submit]')].filter(e=>e.getBoundingClientRect().height>0).map(e=>({id:e.id,text:e.innerText || e.value})),
    text: document.body.innerText.slice(0,1800),
  }));
  console.log(JSON.stringify({stage:'browser',...dom}));
}
async function checkout(label) {
  const order = await api('/orders', { retailerId: ids.retailer, items:[{ productId: ids.product, quantity:1 }] });
  orders.push(order.id);
  const payment = await api('/payments/initiate', { orderId: order.id });
  assert.equal(new URL(payment.bkashURL).hostname, 'sandbox.payment.bkash.com');
  current = { label, orderId: order.id, paymentId: payment.paymentId, paymentID: payment.paymentID };
  const before = await snapshot();
  report.checks.push({ label, stage:'initiated', before }); save();
  await page.goto(payment.bkashURL, { waitUntil:'domcontentloaded',timeout:60000 });
  await inspect();
}
async function cleanup() {
  if (created) {
    await prisma.$transaction(async tx => {
      const ownedOrders = await tx.order.findMany({ where: { srId:ids.user, branchId:ids.branch, retailerId:ids.retailer }, select:{id:true} });
      const orderIds = ownedOrders.map(o=>o.id);
      await tx.auditLog.deleteMany({ where:{userId:ids.user} });
      await tx.payment.deleteMany({ where:{orderId:{in:orderIds}} });
      await tx.orderItem.deleteMany({ where:{orderId:{in:orderIds}} });
      await tx.order.deleteMany({ where:{id:{in:orderIds},srId:ids.user} });
      await tx.branchInventory.deleteMany({ where:{branchId:ids.branch,productId:ids.product} });
      await tx.user.delete({where:{id:ids.user}});
      await tx.retailer.delete({where:{id:ids.retailer}});
      await tx.product.delete({where:{id:ids.product}});
      await tx.branch.delete({where:{id:ids.branch}});
    });
    report.fixturesRemoved = true;
  }
  await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  await prisma.$disconnect();
  report.finishedAt = new Date().toISOString(); save();
}
try {
  const password = crypto.randomBytes(24).toString('base64url');
  const passwordHash = await bcrypt.hash(password,12);
  await prisma.$transaction(async tx => {
    await tx.branch.create({data:{id:ids.branch,name:'Sandbox verification '+runId,code:'TEST-'+runId,type:'TEST',location:'Sandbox'}});
    await tx.user.create({data:{id:ids.user,name:'Sandbox verification SR',email:`sandbox-${runId}@example.invalid`,password:passwordHash,role:'FIELD_SR',branchId:ids.branch}});
    await tx.product.create({data:{id:ids.product,name:'Sandbox verification product',sku:'TEST-'+runId,category:'TEST',unit:'PCS',price:10,costPrice:1}});
    await tx.retailer.create({data:{id:ids.retailer,shopName:'Sandbox verification retailer',ownerName:'Test',phone:'TEST-'+runId,address:'Sandbox',routeArea:'TEST',creditLimit:100}});
    await tx.branchInventory.create({data:{branchId:ids.branch,productId:ids.product,stock:10}});
  });
  created=true;
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  base=`http://127.0.0.1:${server.address().port}/api/v1`;
  config.bkash_callback_url=base+'/payments/callback';
  token=(await api('/auth/login',{email:`sandbox-${runId}@example.invalid`,password})).accessToken;
  browser=await chromium.launch({channel:'chrome',headless:true});
  page=await browser.newPage();
  page.on('response',async response=>{
    if(response.url().startsWith(config.bkash_callback_url)){
      try {const body=await response.json();
        const callbackStatus=new URL(response.url()).searchParams.get('status');
        report.checks.push({label:current?.label,stage:'browser-callback',callbackStatus,httpStatus:response.status(),success:body.success,message:body.message});save();
        console.log(JSON.stringify({stage:'callback',callbackStatus,httpStatus:response.status(),success:body.success,message:body.message}));
      } catch {}
    }
  });
  await checkout('success');
  console.log('READY: enter JSON commands fill, click, inspect, snapshot, query, next, replay, finish');
  const commandFile='.sandbox-artifacts/commands.jsonl';
  fs.writeFileSync(commandFile,'');
  let cursor=0;
  while(true) {
    const lines=fs.readFileSync(commandFile,'utf8').split('\n').filter(Boolean);
    if(cursor>=lines.length){await new Promise(resolve=>setTimeout(resolve,500));continue;}
    const line=lines[cursor++];
    if(!line.trim())continue;
    try {
      const command=JSON.parse(line);
      if(command.action==='fill'){await page.locator(command.selector).fill(command.value);}
      else if(command.action==='click'){await page.locator(command.selector).click();await inspect();}
      else if(command.action==='inspect'){await inspect();}
      else if(command.action==='snapshot'){const data=await snapshot();report.checks.push({label:current.label,stage:'database',...data});save();console.log(JSON.stringify(data));}
      else if(command.action==='query'){const data=await BkashClient.queryPayment(current.paymentID);console.log(JSON.stringify({stage:'gateway-query',paymentIDMatches:data.paymentID===current.paymentID,transactionStatus:data.transactionStatus,statusCode:data.statusCode,amount:data.amount}));}
      else if(command.action==='next'){await checkout(command.label || 'cancel');}
      else if(command.action==='replay'){
        const before=await snapshot();await Promise.all([api(`/payments/callback?paymentID=${encodeURIComponent(current.paymentID)}&status=success`),api(`/payments/callback?paymentID=${encodeURIComponent(current.paymentID)}&status=success`)]);
        const after=await snapshot();assert.deepEqual(after,before);report.checks.push({label:current.label,stage:'duplicate-callback',passed:true});save();console.log('Duplicate callback unchanged: PASS');
      }
      else if(command.action==='finish'){report.completed=command.completed===true;break;}
    } catch(error){console.log(JSON.stringify({stage:'command-error',error:safeError(error)}));}
  }
} catch(error) {report.error=safeError(error);console.log(JSON.stringify({stage:'error',error:report.error}));process.exitCode=1;}
finally {try{await cleanup();}catch(error){report.cleanupError=safeError(error);save();console.log(JSON.stringify({stage:'cleanup-error',error:report.cleanupError}));process.exitCode=1;}}
