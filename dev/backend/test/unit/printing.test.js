process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createSeed } = require("../../src/data/seed");
const { createOrder, payOrder } = require("../../src/domain/rules");
const { issueToken } = require("../../src/domain/auth");
const model = require("../../src/services/print-model");
const service = require("../../src/services/print-service");
const provider = require("../../src/integrations/xpyun/client");
const { handlePrintRoutes } = require("../../src/routes/print-routes");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");
const payments = require("../../src/services/payment-service");

function setup(mode = "pure_points") {
  const state = createSeed();
  const printer = { id:"printer_test",name:"测试站",sn:"TEST1234",paperWidth:80,copies:1,enabled:true,autoPrint:true,registered:true,fulfillmentType:"pickup",siteId:"site_001" };
  model.data(state).printers.push(printer);
  const result = createOrder(state,"u_1001",{paymentMode:mode,fulfillmentType:"pickup",pickupSiteId:"site_001",items:[{productId:mode==="cash"?"p_apple":"p_banana",quantity:1}]});
  assert.equal(result.ok,true,result.error);
  return {state,printer,order:result.order,job:state.printing.jobs[0]};
}
function worker(state, options = {}) {
  let calls=0;
  const client = {print:async()=>{calls++;return "cloud_order";},query:async()=>true,...options.client};
  const instance=service.createWorker({state:()=>state,save:async()=>{},enabled:()=>true,...options,client});
  return {...instance,calls:()=>calls};
}
function authReq(state,role,method) {
  const token=issueToken({type:"admin",roleId:role});
  const payload=JSON.parse(Buffer.from(token.split(".")[0],"base64url"));
  state.authSessions.unshift({id:payload.tokenId,subjectType:"admin",subjectId:role,tokenId:payload.tokenId,issuedAt:new Date(payload.iat*1000).toISOString(),expiresAt:new Date(payload.exp*1000).toISOString(),revokedAt:""});
  return {method,headers:{authorization:`Bearer ${token}`}};
}

test("XPYUN signs official requests and sends offline expiry with a correlation ID", async()=>{
  let request;
  const client=provider.createClient({env:{XPYUN_USER:"test-user",XPYUN_USER_KEY:"test-secret"},fetchImpl:async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({code:0,data:"cloud-1"})};}});
  assert.equal(await client.print({sn:"TEST1234",id:"local-1",content:"hello<BR>",copies:1,expiresIn:3600}),"cloud-1");
  const body=JSON.parse(request.body);
  assert.equal(request.url,"https://open.xpyun.net/api/openapi/xprinter/print");
  assert.equal(body.sign,crypto.createHash("sha1").update("test-usertest-secret"+body.timestamp).digest("hex"));
  assert.equal(body.mode,1);assert.equal(body.attached,"local-1");assert.equal(body.expiresIn,3600);
  assert.equal(body.debug,"0");assert.equal(request.redirect,"error");assert.ok(request.signal);
  assert.equal(request.body.includes("test-secret"),false);
});

test("XPYUN validates partial registration, booleans and uncertain errors without leaking provider data",async()=>{
  const make=result=>provider.createClient({env:{XPYUN_USER:"u",XPYUN_USER_KEY:"secret"},fetchImpl:async()=>({ok:true,json:async()=>result})});
  await assert.rejects(make({code:0,data:{success:[],fail:["TEST1234"]}}).register({sn:"TEST1234",name:"test"}),e=>e.uncertain===false);
  assert.equal(await make({code:0,data:{success:["TEST1234"]}}).register({sn:"TEST1234"}),true);
  assert.equal(await make({code:0,data:false}).query("1"),false);
  await assert.rejects(make({code:0,data:"false"}).query("1"),e=>e.uncertain===true);
  await assert.rejects(make({code:900,message:"secret"}).print({}),e=>e.uncertain===false&&!e.message.includes("secret"));
  await assert.rejects(make({code:0,data:null}).print({}),e=>e.uncertain===true);
  const interrupted=provider.createClient({env:{XPYUN_USER:"u",XPYUN_USER_KEY:"secret"},fetchImpl:async()=>{throw Error("secret transport");}});
  await assert.rejects(interrupted.print({}),e=>e.uncertain===true&&!e.message.includes("secret"));
});

test("paid pure-points and cash orders queue once; pending cash and membership never queue",()=>{
  const {state,order}=setup();
  assert.equal(state.printing.jobs.length,1);
  model.enqueueAuto(state,order);assert.equal(state.printing.jobs.length,1);
  const cash=setup("cash");assert.equal(cash.state.printing.jobs.length,0);
  payOrder(cash.state,cash.order.id);payOrder(cash.state,cash.order.id);
  assert.equal(cash.state.printing.jobs.length,1);
  assert.equal(cash.state.printing.jobs[0].test,true);
  const membership=payments.createMemberPayment(state,state.users.find(u=>u.id==="u_1001"),{idempotencyKey:"print-member-test"});
  assert.equal(membership.ok,true,membership.error);
  assert.equal(payments.mockPaymentCallback(state,membership.payment.payNo).ok,true);
  assert.equal(state.printing.jobs.length,1);
});

test("payment callbacks enqueue a single snapshot and correctly mark simulated receipts",()=>{
  const {state,order}=setup("cash");
  const payment=payments.createGoodsPayment(state,order.id,{});
  assert.equal(payment.ok,true,payment.error);
  assert.equal(state.printing.jobs.length,0);
  assert.equal(payments.mockPaymentCallback(state,payment.payment.payNo).ok,true);
  payments.mockPaymentCallback(state,payment.payment.payNo);
  assert.equal(state.printing.jobs.length,1);assert.equal(state.printing.jobs[0].test,true);
});

test("real provider callback queues once with verified evidence and routes only matching devices",async()=>{
  const {state,printer,order}=setup("cash");
  state.printing.printers.push({...printer,id:"other_site",sn:"OTHER0001",siteId:"site_002"},{...printer,id:"delivery",sn:"DELIVERY1",fulfillmentType:"delivery",siteId:""});
  const payment=payments.createGoodsPayment(state,order.id,{channel:"lfwin"}).payment;
  const notification={mch_orderid:payment.payNo,orderid:"real-cloud-order",trade_no:"real-trade",paystatus:"1",paymoney:payment.amount};
  const verifiedClient={verifyNotification:()=>true};
  assert.equal((await payments.applyLfwinPaymentNotification(state,notification,verifiedClient)).ok,true);
  await payments.applyLfwinPaymentNotification(state,notification,verifiedClient);
  assert.equal(state.printing.jobs.length,1);assert.equal(state.printing.jobs[0].printerId,printer.id);
  assert.equal(state.printing.jobs[0].test,false);
});

test("receipt uses selected paper width, escapes commands and excludes pickup verification secrets",()=>{
  const {state,order,printer}=setup();
  order.items[0].title="<CUT>"+"苹果".repeat(35);
  order.pickupCode="SECRET_PICKUP_CODE";
  state.stationOrders=[{orderId:order.id,packages:[{shelfCode:"A-01",bagCount:2},{shelfCode:"C-02",bagCount:1}]}];
  const wide=model.buildReceipt(state,order,printer).content;
  assert.ok(wide.includes("-".repeat(48)+"<BR>"));
  assert.ok(wide.includes("A-01"));assert.ok(wide.includes("C-02"));
  assert.equal(wide.includes("<CUT>"),false);assert.equal(wide.includes(order.pickupCode),false);
  const narrow=model.buildReceipt(state,order,{...printer,paperWidth:58}).content;
  assert.ok(narrow.includes("-".repeat(32)+"<BR>"));assert.ok(narrow.split("<BR>").length>wide.split("<BR>").length);
  order.items=Array.from({length:200},()=>({title:"苹果".repeat(80),quantity:1}));
  assert.throws(()=>model.buildReceipt(state,order,printer),/超过小票/);
});

test("concurrent worker sweeps persist sending intent before IO and confirm printing later",async()=>{
  const {state,job}=setup();let durable;
  const instance=worker(state,{save:async()=>{durable=JSON.parse(JSON.stringify(state));},client:{print:async()=>{assert.equal(durable.printing.jobs[0].status,"sending");return "cloud-1";}}});
  await Promise.all([instance.run(),instance.run()]);
  assert.equal(job.status,"accepted");assert.equal(job.attempts,1);
  await instance.run();assert.equal(job.status,"printed");assert.equal(job.attempts,1);
});

test("interrupted sends and restart sending intents become unknown and are never automatically resent",async()=>{
  for(const restart of [false,true]) {
    const {state,job}=setup();if(restart)job.status="sending";
    let calls=0;const instance=worker(state,{client:{print:async()=>{calls++;throw new provider.PrintError("timeout",true);}}});
    await instance.run();await instance.run();
    assert.equal(job.status,"unknown");assert.equal(calls,restart?0:1);
    assert.equal((await service.jobAction(state,job.id,"retry",{reason:"retry"},"admin")).status,409);
    assert.equal((await service.jobAction(state,job.id,"resolve",{reason:"checked",outcome:"cancelled"},"admin")).status,400);
    assert.equal((await service.jobAction(state,job.id,"resolve",{reason:"cloud cleared",outcome:"cancelled",confirmCloudCleared:true},"admin")).ok,true);
  }
});

test("storage failures halt this worker; restart never resends an accepted but unrecorded job",async()=>{
  for(const failAt of [1,2]) {
    const {state,job}=setup();let saves=0,calls=0,durable;
    const instance=worker(state,{save:async()=>{if(++saves===failAt)throw Error("disk failed");durable=JSON.parse(JSON.stringify(state));},client:{print:async()=>{calls++;return "cloud-1";}}});
    await assert.rejects(instance.run(),/disk failed/);await instance.run();
    assert.equal(calls,failAt===1?0:1);
    if(durable) {const restarted=worker(durable);await restarted.run();assert.equal(durable.printing.jobs[0].status,"unknown");assert.equal(restarted.calls(),0);}
    assert.ok(["sending","accepted"].includes(job.status));
  }
});

test("refunds before send and during intent persistence cancel the local job",async()=>{
  for(const duringSave of [false,true]) {
    const {state,order,job}=setup();if(!duringSave)order.status="refunding";
    const instance=worker(state,{save:async()=>{if(duringSave)order.status="refunded";}});
    await instance.run();assert.equal(instance.calls(),0);assert.equal(job.status,"cancelled");
  }
});

test("disabled/unverified printers hold jobs, mismatched sites cancel, expired accepted jobs need reconciliation",async()=>{
  const {state,printer,job}=setup();printer.registered=false;
  const instance=worker(state);await instance.run();assert.equal(job.status,"queued");
  printer.registered=true;printer.enabled=false;await instance.run();assert.equal(job.status,"queued");
  printer.enabled=true;printer.siteId="other";await instance.run();assert.equal(job.status,"cancelled");assert.equal(instance.calls(),0);
  job.status="accepted";job.providerOrderId="cloud-old";job.sentAt="2000-01-01T00:00:00Z";
  await instance.run();assert.equal(job.status,"unconfirmed");assert.equal(instance.calls(),0);
});

test("explicit rejection can be retried; cloud pending stays accepted without resubmission",async()=>{
  const {state,job}=setup();const rejected=worker(state,{client:{print:async()=>{throw new provider.PrintError("rejected",false);}}});
  await rejected.run();assert.equal(job.status,"failed");
  assert.equal((await service.jobAction(state,job.id,"retry",{reason:"device fixed"},"admin")).ok,true);
  const success=worker(state,{client:{query:async()=>false}});await success.run();await success.run();
  assert.equal(job.status,"accepted");assert.equal(success.calls(),1);
  assert.equal((await service.jobAction(state,job.id,"cancel",{reason:"cancel"},"admin")).status,409);
});

test("manual printing blocks duplicate in-flight requests, scopes idempotency, and labels explicit reprints",async()=>{
  const {state,printer,order,job}=setup();const input={printerId:printer.id,idempotencyKey:"manual-print-123",reason:"补打"};
  assert.equal((await service.requestPrint(state,order.id,input,"admin")).status,409);
  job.status="printed";assert.equal((await service.requestPrint(state,order.id,input,"admin")).status,409);
  input.reprint=true;const result=await service.requestPrint(state,order.id,input,"admin");
  assert.equal(result.ok,true);assert.match(result.job.content,/补打联/);
  assert.equal((await service.requestPrint(state,order.id,input,"admin")).job.id,result.job.id);
  assert.equal(state.printing.jobs.length,2);
  const extra=createOrder(state,"u_1001",{paymentMode:"pure_points",items:[{productId:"p_banana",quantity:1}]}).order;
  assert.equal((await service.requestPrint(state,extra.id,input,"admin")).status,409);
});

test("printer settings validate SN immutability, duplicate binding, paper width, site and audit reasons",async()=>{
  const {state,printer}=setup();const input={...printer,reason:"配置"};
  assert.equal((await service.savePrinter(state,printer.id,{...input,paperWidth:60},"admin")).status,400);
  assert.equal((await service.savePrinter(state,printer.id,{...input,sn:"OTHER1234"},"admin")).status,409);
  assert.equal((await service.savePrinter(state,null,input,"admin")).status,409);
  assert.equal((await service.savePrinter(state,printer.id,{...input,siteId:"missing"},"admin")).status,400);
  assert.equal((await service.savePrinter(state,printer.id,{...input,reason:""},"admin")).status,400);
  assert.equal((await service.savePrinter(state,printer.id,{...input,paperWidth:58},"admin")).ok,true);
  assert.equal(printer.paperWidth,58);assert.equal(state.adminOperationLogs[0].action,"printer.save");
});

test("an old failed task cannot be retried after a replacement task was queued",async()=>{
  const {state,order,printer,job}=setup();job.status="failed";
  const replacement=await service.requestPrint(state,order.id,{printerId:printer.id,idempotencyKey:"replacement-1",reason:"重新打印"},"admin");
  assert.equal(replacement.ok,true);
  assert.equal((await service.jobAction(state,job.id,"retry",{reason:"重试旧任务"},"admin")).status,409);
  replacement.job.status="printed";
  assert.equal((await service.jobAction(state,job.id,"retry",{reason:"重试旧任务"},"admin")).status,409);
});

test("SQLite reload preserves jobs, device settings, receipt snapshots and auditing",async()=>{
  const {state,printer,job}=setup();
  await service.savePrinter(state,printer.id,{...printer,reason:"SQLite打印配置"},"admin");
  job.status="unknown";job.error="network timeout";
  saveSQLiteState(state,":memory:");const restored=loadSQLiteState(":memory:");
  assert.deepEqual(restored.printing,state.printing);
  assert.equal(restored.adminOperationLogs[0].action,"printer.save");
  assert.equal(service.summary(restored).jobs[0].content,undefined);
  assert.equal(service.summary(restored).jobs[0].key,undefined);
});

test("printing routes enforce permissions before parsing bodies and redact receipt content",async()=>{
  const {state}=setup();let parsed=0;
  const ctx={state,res:{},readBody:async()=>{parsed++;return {};},send:(_res,status,data)=>({status,data})};
  for(const path of ["/api/admin/printing/printers","/api/admin/printing/orders/order1","/api/admin/printing/jobs/job1/retry"]) {
    const result=await handlePrintRoutes({...ctx,req:authReq(state,"customer_service","POST"),url:new URL(path,"http://localhost")});
    assert.equal(result.status,403);assert.equal(parsed,0);
  }
  const anonymous=await handlePrintRoutes({...ctx,req:{method:"GET",headers:{}},url:new URL("http://localhost/api/admin/printing")});
  assert.equal(anonymous.status,401);
  const overview=await handlePrintRoutes({...ctx,req:authReq(state,"super_admin","GET"),url:new URL("http://localhost/api/admin/printing")});
  assert.equal(overview.status,200);assert.equal(overview.data.jobs[0].content,undefined);assert.equal(overview.data.jobs[0].key,undefined);
});
