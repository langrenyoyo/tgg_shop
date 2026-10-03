const { randomUUID } = require("node:crypto");
const { saveState, getState } = require("../data/store");
const provider = require("../integrations/xpyun/client");
const model = require("./print-model");
const { exclusive } = require("./operation-lock");
let workerError = "";

function audit(state, actor, action, targetId, reason) {
  (state.adminOperationLogs ||= []).unshift({ id: `printlog_${randomUUID()}`, adminId: actor || null, roleId: "", action, targetType: "printing", targetId, reason, before: {}, after: {}, createdAt: new Date().toISOString() });
}
function summary(state) {
  const store = model.data(state);
  return { configured: provider.configured(), enabled: provider.config().enabled, workerError, printers: store.printers,
    sites: (state.pickupSites || []).map(p => ({ id:p.id,name:p.name })),
    jobs: store.jobs.slice(0, 200).map(({ content, key, ...job }) => job), totalJobs: store.jobs.length };
}
async function savePrinter(state, id, input, actor) {
  const store = model.data(state);
  const previous = id ? store.printers.find(p => p.id === id) : null;
  if (id && !previous) return model.fail(404, "打印机不存在");
  const reason = String(input.reason || "").trim();
  const name = String(input.name || "").trim(), sn = String(input.sn || "").trim();
  const fulfillmentType = input.fulfillmentType, siteId = fulfillmentType === "pickup" ? String(input.siteId || "") : "";
  if (!reason || reason.length > 200 || !name || name.length > 50 || !/^[a-zA-Z0-9_-]{4,60}$/.test(sn)) return model.fail(400, "请填写有效名称、设备编号和操作原因");
  if (!["pickup", "delivery"].includes(fulfillmentType) || (fulfillmentType === "pickup" && !state.pickupSites.some(s => s.id === siteId))) return model.fail(400, "请选择有效自提点或配送用途");
  if (![58,80].includes(input.paperWidth) || !Number.isInteger(input.copies) || input.copies < 1 || input.copies > 5) return model.fail(400, "纸宽须为58或80，份数须为1至5");
  if (typeof input.enabled !== "boolean" || typeof input.autoPrint !== "boolean") return model.fail(400, "启用和自动打印必须为布尔值");
  if (previous && previous.sn !== sn) return model.fail(409, "设备编号不可修改，请停用后新增设备");
  if (store.printers.some(p => p.sn === sn && p.id !== id)) return model.fail(409, "设备编号已存在");
  if (!previous && store.printers.length >= 100) return model.fail(400, "最多支持100台打印机");
  const printer = { ...previous, id: previous?.id || `printer_${randomUUID()}`, name, sn, fulfillmentType, siteId,
    paperWidth: input.paperWidth, copies: input.copies, enabled: input.enabled, autoPrint: input.autoPrint,
    shopName: model.clean(input.shopName || "TGG Shop", 40), footer: model.clean(input.footer || "请核对商品与数量", 120), updatedAt: new Date().toISOString() };
  if (previous) Object.assign(previous, printer); else store.printers.push(printer);
  audit(state, actor, "printer.save", printer.id, reason);
  await saveState();
  return { ok:true, printer };
}
async function deviceAction(state, id, action, input, actor, client = provider.createClient()) {
  const printer = model.data(state).printers.find(p => p.id === id);
  if (!printer) return model.fail(404, "打印机不存在");
  if (!provider.configured()) return model.fail(503, "请在服务器配置 XPYUN_USER 和 XPYUN_USER_KEY");
  return exclusive(printer, async () => {
    try {
      if (action === "register") await client.register(printer);
      printer.deviceStatus = await client.status(printer.sn);
      printer.registered = true;
      printer.checkedAt = new Date().toISOString();
      audit(state, actor, `printer.${action}`, id, "核对芯烨云设备状态");
    } catch (error) { return model.fail(502, error.message); }
    await saveState();
    return { ok:true, printer };
  });
}
function requestKey(input) { return typeof input.idempotencyKey === "string" && /^[a-zA-Z0-9:_-]{8,160}$/.test(input.idempotencyKey); }
async function requestPrint(state, orderId, input, actor) {
  if (!requestKey(input) || !String(input.reason || "").trim()) return model.fail(400,"需要请求标识和打印原因");
  const store = model.data(state), order = state.orders.find(o => o.id === orderId), printer = store.printers.find(p => p.id === input.printerId);
  if (!order || !printer) return model.fail(404,"订单或打印机不存在");
  const key = `manual:${actor}:${input.idempotencyKey}`;
  const existing = store.jobs.find(j => j.key === key);
  if (existing) return existing.orderId === orderId && existing.printerId === printer.id ? {ok:true,job:existing,idempotent:true} : model.fail(409,"请求标识已用于其他打印任务");
  const prior = store.jobs.filter(j => j.orderId === orderId && j.printerId === printer.id);
  if (prior.some(j => ["queued","sending","accepted","unknown","unconfirmed"].includes(j.status))) return model.fail(409,"已有打印任务排队或结果待核对，请先处理原任务");
  const reprint = prior.some(j => j.status === "printed");
  if (reprint && input.reprint !== true) return model.fail(409,"订单已有出纸记录，请确认补打");
  const result = model.queue(state, order, printer, {key,actor,reason:String(input.reason).slice(0,200),reprint});
  if (!result.ok) return result;
  audit(state,actor,reprint?"print.reprint":"print.request",result.job.id,result.job.reason);
  await saveState(); return result;
}
async function testPage(state,id,input,actor) {
  const store=model.data(state), printer=store.printers.find(p=>p.id===id);
  if (!printer || !printer.enabled) return model.fail(400,"请先启用打印机");
  if (!requestKey(input)) return model.fail(400,"需要有效请求标识");
  const key=`test:${actor}:${input.idempotencyKey}`, existing=store.jobs.find(j=>j.key===key);
  if(existing) return existing.printerId===id ? {ok:true,job:existing,idempotent:true} : model.fail(409,"请求标识冲突");
  const now=new Date().toISOString();
  const job={id:`prj_${randomUUID()}`,key,printerId:id,sn:printer.sn,orderId:null,test:true,content:`<CB>打印机测试页<BR></CB>${model.clean(printer.name)}<BR>纸宽 ${printer.paperWidth}mm<BR>测试订单，未实际收款<BR>${now}<BR><BR>`,copies:1,expiresIn:300,status:"queued",attempts:0,actor,reason:"设备测试",createdAt:now,updatedAt:now};
  store.jobs.unshift(job); audit(state,actor,"print.test",job.id,"打印测试页"); await saveState(); return {ok:true,job};
}
async function jobAction(state,id,action,input,actor,client=provider.createClient()) {
  const store=model.data(state),job=store.jobs.find(j=>j.id===id);
  if(!job) return model.fail(404,"任务不存在");
  return exclusive(job,async()=>{
    if(action==="query") {
      if(!job.providerOrderId) return model.fail(409,"未取得云端任务号，请在芯烨云后台人工核对");
      if(!provider.configured()) return model.fail(503,"芯烨云账号尚未配置");
      try { const done=await client.query(job.providerOrderId); if(done) job.status="printed"; job.checkedAt=new Date().toISOString(); job.error=""; }
      catch(error) { return model.fail(502,error.message); }
    } else {
      if(!String(input.reason||"").trim()) return model.fail(400,"请填写操作原因");
      if(action==="retry") {
        if(!["failed","cancelled"].includes(job.status) || job.providerOrderId || !job.content) return model.fail(409,"此任务不可重试，结果未知时须先核对");
        if(job.orderId && !model.printable(state.orders.find(o=>o.id===job.orderId))) return model.fail(409,"订单状态不允许打印");
        if(job.orderId && store.jobs.some(other=>other.id!==job.id && other.orderId===job.orderId && other.printerId===job.printerId && ["queued","sending","accepted","unknown","unconfirmed","printed"].includes(other.status))) return model.fail(409,"该订单已有其他打印记录，请核对后通过订单补打入口处理");
        job.status="queued"; job.error="";
      } else if(action==="cancel") {
        if(!["queued","failed"].includes(job.status) || job.providerOrderId) return model.fail(409,"只能取消尚未发送的任务；云端排队任务请在芯烨云后台处理");
        job.status="cancelled";
      } else if(action==="resolve") {
        if(!["unknown","unconfirmed"].includes(job.status) || !["printed","cancelled"].includes(input.outcome)) return model.fail(409,"只能核对结果未知的任务");
        if(input.outcome==="cancelled" && input.confirmCloudCleared!==true) return model.fail(400,"请确认云端无待打印任务，避免补打后重复出纸");
        job.status=input.outcome; job.error=""; job.resolution=String(input.reason).slice(0,200); job.resolvedAt=new Date().toISOString();
      } else return model.fail(400,"无效操作");
      audit(state,actor,`print.${action}`,id,String(input.reason).slice(0,200));
    }
    job.updatedAt=new Date().toISOString(); await saveState(); return {ok:true,job};
  });
}
function createWorker({ state=getState, save=saveState, client=provider.createClient(), enabled=()=>provider.config().enabled && provider.configured() }={}) {
  let running=null,stopped=false,cursor=null;
  async function run() {
    if(stopped || !enabled()) return;
    const store=model.data(state());
    const jobs=store.jobs.filter(j=>["queued","sending","accepted"].includes(j.status));
    const offset=jobs.findIndex(j=>j.id===cursor)+1;
    for(const job of jobs.slice(offset).concat(jobs.slice(0,offset)).slice(0,10)) {
      if(stopped) break;
      cursor=job.id;
      await exclusive(job,async()=>{
        if(job.status==="sending") { job.status="unknown"; job.error="服务中断，发送结果待核对"; await save(); return; }
        if(job.status==="accepted") {
          if(Date.now()-Date.parse(job.sentAt)>86400000) { job.status="unconfirmed"; job.error="超过24小时未确认出纸，请核对云端和纸张"; await save(); return; }
          try {
            if(await client.query(job.providerOrderId)) job.status="printed";
            job.checkedAt=new Date().toISOString(); job.error="";
          } catch(error) { job.error=error.message; }
          await save(); return;
        }
        if(job.status!=="queued") return;
        const printer=store.printers.find(p=>p.id===job.printerId);
        if(!printer?.enabled || !printer.registered) return;
        const order=job.orderId && state().orders.find(o=>o.id===job.orderId);
        if(job.orderId && (!model.printable(order) || !model.matches(printer,order))) {
          job.status="cancelled"; job.error="订单已取消、退款或站点配置已变更"; await save(); return;
        }
        job.status="sending"; job.sentAt=new Date().toISOString(); job.attempts=(job.attempts||0)+1;
        // No external write until intent is durable. Failure halts this sweep.
        await save();
        // A refund or device edit can arrive while the durable write is pending.
        if (!printer.enabled || (job.orderId && (!model.printable(order) || !model.matches(printer, order)))) {
          job.status="cancelled"; job.error="发送前订单或设备状态已变更"; await save(); return;
        }
        try { job.providerOrderId=await client.print(job); job.status="accepted"; job.error=""; }
        catch(error) { job.status=error.uncertain===false?"failed":"unknown"; job.error=error.message; }
        job.updatedAt=new Date().toISOString(); await save();
      });
    }
  }
  return { run(){ if(!running) running=run().catch(error=>{
    // Fail closed after a storage fault. Restart reloads the durable sending intent
    // as unknown, so an accepted-but-unrecorded request is never silently resent.
    stopped=true; workerError="打印服务因保存失败已暂停，请修复存储并重启服务后核对任务"; throw error;
  }).finally(()=>{running=null;});return running; },async stop(){stopped=true;if(running)await running;} };
}
module.exports={summary,savePrinter,deviceAction,requestPrint,testPage,jobAction,createWorker};
