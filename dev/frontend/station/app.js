import { createCameraScanner } from "./scanner.js";

const TOKEN_KEY = "tggStationToken";
const REFRESH_KEY = "tggStationRefreshToken";
const state = { token: localStorage.getItem(TOKEN_KEY) || "", refreshToken: localStorage.getItem(REFRESH_KEY) || "", station: null, sites: [], dashboard: null, orders: [], logs: [], view: "dashboard", filter: "all", keyword: "", loading: false, submitting: false, dialog: null, scanner: null };
const app = document.querySelector("#app");
const cameraScanner = createCameraScanner({ onError: message => toast(message) });

async function api(path, options = {}, retry = true) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (response.status === 401 && retry && state.refreshToken) {
    const refreshed = await fetch("/api/station/auth/refresh", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ refreshToken:state.refreshToken }) });
    if (refreshed.ok) { const data = await refreshed.json(); saveAuth(data); return api(path, options, false); }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || "请求失败"); error.status = response.status; throw error; }
  return data;
}
function saveAuth(data) { state.token=data.token || ""; state.refreshToken=data.refreshToken || state.refreshToken; localStorage.setItem(TOKEN_KEY,state.token); localStorage.setItem(REFRESH_KEY,state.refreshToken); }
function clearAuth() { state.token=""; state.refreshToken=""; localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY); }
function toast(message) { const el=document.querySelector("#toast"); el.textContent=message; el.hidden=false; setTimeout(()=>{el.hidden=true},2600); }
function esc(value) { return String(value ?? "").replace(/[&<>\"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function statusLabel(status) { return ({ expected:"待到站",picking:"拣货中",in_transit:"运输中",received:"已收货",ready:"待提货",picked_up:"已提货",completed:"已完成",exception:"异常" })[status] || status || "未知"; }
function tag(status) { const cls=["ready","picked_up","completed"].includes(status)?"done":status==="exception"?"bad":status==="ready"?"ready":""; return `<span class="tag ${cls}">${statusLabel(status)}</span>`; }

function render() { state.token ? renderShell() : renderLogin(); }
function renderLogin() { app.innerHTML=`<section class="login"><div class="brand">TGG SHOP · 站点端</div><h1>站点工作人员登录</h1><p class="muted">登录后只能查看和操作已授权的自提站点。</p><form class="form" id="loginForm"><label>账号<input name="username" value="station001" autocomplete="username" required></label><label>密码<input name="password" type="password" value="123456" autocomplete="current-password" required></label><button class="primary">登录站点</button></form></section>`; document.querySelector("#loginForm").onsubmit=login; }
function renderShell() { const siteName=state.sites[0]?.name || "授权自提站"; app.innerHTML=`<header class="topbar"><div><div class="brand">TGG SHOP · 站点端</div><h1>${esc(siteName)}</h1><p class="muted">${esc(state.station?.name || "站点工作人员")}</p></div><div class="topbar-actions"><button class="secondary" data-action="refresh">刷新</button><button class="secondary" data-action="logout">退出登录</button></div></header><div class="layout"><nav class="nav"><button class="${state.view==="dashboard"?"active":""}" data-view="dashboard">工作台</button><button class="${state.view==="receive"?"active":""}" data-view="receive">待收货</button><button class="${state.view==="pickup"?"active":""}" data-view="pickup">待提货</button><button class="${state.view==="logs"?"active":""}" data-view="logs">操作日志</button></nav><main class="content">${viewContent()}</main></div>${state.dialog?dialog(state.dialog):""}`; bindShell(); }
function viewContent() { if(state.view==="dashboard") return dashboardView(); if(state.view==="logs") return logsView(); const wanted=state.view==="receive"?["expected","in_transit","picking"]:["ready","received","exception"]; return ordersView(wanted); }
function dashboardView() { const c=state.dashboard?.counts || {}; const p=state.dashboard?.pickingConfig || {}; return `<div class="cards"><div class="stat">待收货<strong>${c.pendingReceive||0}</strong></div><div class="stat">待提货<strong>${c.readyPickup||0}</strong></div><div class="stat">今日已提货<strong>${c.todayPickedUp||0}</strong></div><div class="stat">异常订单<strong>${c.exceptions||0}</strong></div></div><section class="panel"><h2>现场操作</h2><p class="muted">${p.enabled===false?"站点拣货功能当前已关闭。":"订单会按商品库位排序，收货时核对库位和条码后再上架。"}</p><div class="toolbar"><button class="primary" data-action="open-receive" ${p.enabled===false?"disabled":""}>手动收货</button><button class="secondary" data-action="open-pickup">核验提货</button><button class="secondary" data-action="open-exception">登记异常</button></div><p class="muted">${p.scanRequired?"当前要求扫码核对全部商品。":"当前允许人工确认商品，商品已配置条码时可扫码复核。"} 提货位前缀：${esc(p.shelfPrefix||"S-")}</p></section><section class="panel"><h2>授权站点</h2>${(state.sites||[]).map(s=>`<p><strong>${esc(s.name)}</strong><br><span class="muted">${esc(s.address)} · ${esc(s.contactPhone)}</span></p>`).join("")||"<p class=muted>暂无授权站点</p>"}</section>`; }
function batchSummary(orders) {
  if(state.view!=="receive" || !state.dashboard?.pickingConfig?.batchEnabled) return "";
  const summary=new Map();
  orders.forEach(order=>(order.pickingItems||[]).forEach(item=>{
    const key=order.pickupSiteId+":"+item.productId, row=summary.get(key)||{...item,siteId:order.pickupSiteId,quantity:0};
    row.quantity+=item.quantity;summary.set(key,row);
  }));
  return `<section class="panel"><h2>多单商品汇总</h2><p class="muted">按站点备货，逐单领取、核对分装和上架。</p>${[...summary.values()].sort((a,b)=>a.pickSequence-b.pickSequence || a.locationCode.localeCompare(b.locationCode)).map(row=>`<p>${esc(row.siteId)} · ${esc(row.locationCode)} · ${esc(row.title)} × ${row.quantity}</p>`).join("")}</section>`;
}
function ordersView(statuses) { const orders=state.orders.filter(o=>o.status==="paid" && statuses.includes(o.stationStatus)); return `<section class="panel"><div class="toolbar"><input id="keyword" placeholder="订单号、商品或储位号" value="${esc(state.keyword)}"><button class="primary" data-action="search">查询</button><button class="secondary" data-action="open-${state.view==='receive'?'receive':'pickup'}">${state.view==='receive'?'手动收货':'输入取货码'}</button></div></section>${batchSummary(orders)}<section class="orders">${orders.length?orders.map(orderCard).join(""):"<div class=empty>暂无符合条件的订单</div>"}</section>`; }
function orderCard(order) { const pickItems=order.pickingItems||order.items||[]; return `<article class="order"><div class="order-head"><strong>${esc(order.id)}</strong>${tag(order.stationStatus)}</div><div class="pick-list">${pickItems.map(i=>`<div class="pick-row"><strong>${esc(i.locationCode||"未配置库位")}</strong><span>${esc(i.title||i.name||i.productId)} × ${i.quantity}</span><small>${i.storageType?esc(({ambient:"常温",chilled:"冷藏",frozen:"冷冻",fresh:"生鲜"})[i.storageType]||i.storageType):""}${i.backupLocation?` · 备用库位 ${esc(i.backupLocation)}`:""}${i.barcode?` · 条码 ${esc(i.barcode)}`:""}</small></div>`).join("")}</div><div class="order-meta"><span class="muted">站点：${esc(order.pickupSiteId)} · 提货位：${esc(order.shelfCode||"待分配")}</span><span class="muted">${esc(order.receivedAt||order.createdAt||"")}${order.holdUntil?` · 保管至 ${esc(order.holdUntil)}${order.overdue?"（已超时，请跟进）":""}`:""}</span></div><div class="actions">${order.stationStatus==='ready'||order.stationStatus==='received'?`<button class="primary" data-action="pickup" data-id="${esc(order.id)}">核验提货</button>`:`<button class="primary" data-action="receive" data-id="${esc(order.id)}">确认收货</button>`}<button class="secondary" data-action="exception" data-id="${esc(order.id)}">登记异常</button><button class="secondary" data-action="detail" data-id="${esc(order.id)}">查看详情</button></div></article>`; }
function logsView() { return `<section class="panel"><h2>操作日志</h2><p class="muted">只显示授权站点日志，日志不可修改。</p></section><section class="orders">${(state.logs||[]).map(l=>`<article class="order"><div class="order-head"><strong>${esc(l.orderId||"站点操作")}</strong><span class="tag">${esc(l.action)}</span></div><div class="muted">${esc(l.reason||l.result||"")} · ${esc(l.operatorId)} · ${esc(l.createdAt)}</div></article>`).join("")||"<div class=empty>暂无操作日志</div>"}</section>`; }
function dialog(dialogState) { const kind=dialogState.kind; const order=dialogState.order; if(kind==='detail') return `<div class=dialog><section class=dialog-card><h2>订单详情</h2><pre>${esc(JSON.stringify(order,null,2))}</pre><button class=secondary data-action=close>关闭</button></section></div>`; const pickup=kind==='pickup'; const exception=kind==='exception'; const items=order?.pickingItems||[]; return `<div class=dialog><section class=dialog-card><h2>${exception?'登记异常':pickup?'提货核验':'确认收货'}</h2><p class=muted>${order?esc(order.id):'请输入订单号'}</p><form class=form id=actionForm>${!order?`<label>订单号<div class=input-scan><input name=orderId required><button type=button class=secondary data-action=scan data-scan-target=orderId>扫码</button></div></label>`:''}${pickup?`<label>取货码<div class=input-scan><input name=pickupCode inputmode=numeric required autofocus><button type=button class=secondary data-action=scan data-scan-target=pickupCode>扫码</button></div></label>`:''}${!pickup&&!exception?`<label>提货位<input name=shelfCode placeholder="例如 S-01-08"></label><label>货物状态<select name=condition><option value=normal>正常</option><option value=shortage>缺货</option><option value=damaged>货损</option><option value=quantity_mismatch>数量不符</option></select></label>${items.length?`<div class="scan-items"><strong>拣货核对</strong>${items.map(item=>`<div class="scan-item"><span><b>${esc(item.locationCode||"未配置库位")}</b> ${esc(item.title)} × ${item.quantity}</span><input name="quantity_${esc(item.productId)}" type="number" min="0" step="1" placeholder="实收数量" required>${item.backupLocation?`<small>备用库位 ${esc(item.backupLocation)}</small>`:""}${item.barcode?`<div class=input-scan><input name="barcode_${esc(item.productId)}" placeholder="条码 ${esc(item.barcode)}" ><button type=button class=secondary data-action=scan data-scan-target=productBarcode data-product-id="${esc(item.productId)}">扫码</button></div>`:`<small class=muted>未配置条码，请后台补充</small>`}</div>`).join("")}</div>`:""}`:''}${exception?`<label>异常类型<select name=type><option value=wrong_site>错站订单</option><option value=missing>商品缺失</option><option value=damaged>商品破损</option><option value=quantity_mismatch>数量不符</option><option value=invalid_code>取货码无效</option><option value=system_error>系统故障</option></select></label>`:''}<label>备注<textarea name=remark></textarea></label><div class=actions><button class=primary>${exception?'提交异常':pickup?'确认提货':'确认收货'}</button><button type=button class=secondary data-action=close>取消</button></div></form></section></div>`; }
async function login(event) { event.preventDefault(); const body=Object.fromEntries(new FormData(event.target)); try { saveAuth(await fetch("/api/station/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;})); await load(); } catch(e){ toast(e.message); } }
async function load() { try { const [me,dashboard,orders,logs]=await Promise.all([api("/station/me"),api("/station/dashboard"),api("/station/orders"),api("/station/operation-logs")]); state.station=me.station;state.sites=me.sites||[];state.dashboard=dashboard;state.orders=orders||[];state.logs=logs||[];render(); } catch(e){ if(e.status===401){clearAuth();render();} else toast(e.message); } }
function bindShell() { document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render();}); document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>action(b.dataset.action,b.dataset.scanTarget || b.dataset.id,b.dataset.productId)); document.querySelector("#actionForm")?.addEventListener("submit",submitAction); document.querySelector("#keyword")?.addEventListener("input",e=>state.keyword=e.target.value); }
async function scanFormField(target, productId = "") { const field=target === "productBarcode" ? [...document.querySelectorAll("#actionForm input")].find(input => input.name === `barcode_${productId}`) : document.querySelector(`#actionForm [name="${target}"]`); if(!field) return; await cameraScanner.start({ target, selectedOrderId: state.dialog?.order?.id || "", onResult: result => { if(result.orderId && state.dialog?.kind === "pickup" && state.dialog.order?.id && result.orderId !== state.dialog.order.id) { toast("扫码订单与当前订单不一致"); return; } if(result.orderId && target === "orderId") field.value=result.orderId; if(result.pickupCode && target === "pickupCode") field.value=result.pickupCode; if(result.productBarcode && target === "productBarcode") field.value=result.productBarcode; field.dispatchEvent(new Event("input", { bubbles:true })); field.focus(); } }); }
async function action(name,id,productId) { if(name==='scan'){scanFormField(id,productId);return;} if(name==='logout'){ cameraScanner.stop(); try { if(state.token) await fetch('/api/station/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${state.token}`}}); } finally { clearAuth(); state.station=null; state.sites=[]; state.orders=[]; state.logs=[]; state.dialog=null; render(); } return;} if(name==='refresh'){load();return;} if(name==='search'){loadOrders();return;} if(name==='close'){if(state.submitting || state.dialog?.attempt){toast("请先重试确认当前操作");return;} cameraScanner.stop(); if(state.dialog?.claimed){try { await api(`/station/orders/${encodeURIComponent(state.dialog.order.id)}/picking`,{method:"POST",body:JSON.stringify({release:true})}); } catch(e){toast(e.message);return;}} state.dialog=null;await load();return;} if(name==='receive'||name==='open-receive'){if(state.submitting)return; try { const result=id?await api(`/station/orders/${encodeURIComponent(id)}/picking`,{method:"POST",body:"{}"}):null; state.dialog={kind:'receive',order:result?.order||null,claimed:Boolean(result)};render(); } catch(e){toast(e.message);}return;} if(name==='pickup'||name==='open-pickup'){state.dialog={kind:'pickup',order:id?state.orders.find(o=>o.id===id):null};render();return;} if(name==='exception'||name==='open-exception'){state.dialog={kind:'exception',order:id?state.orders.find(o=>o.id===id):null};render();return;} if(name==='detail'){state.dialog={kind:'detail',order:state.orders.find(o=>o.id===id)};render();} }
async function loadOrders() { try { state.orders=await api(`/station/orders?keyword=${encodeURIComponent(state.keyword)}`);render(); } catch(e){toast(e.message);} }
async function submitAction(event) {
  event.preventDefault(); if(state.submitting) return;
  state.submitting=true; cameraScanner.stop();
  const form=event.target, dialogState=state.dialog;
  const submit=form.querySelector('button.primary'); if(submit) submit.disabled=true;
  try {
    let body=dialogState.attempt || Object.fromEntries(new FormData(form));
    const orderId=dialogState.order?.id || body.orderId;
    if(!orderId) throw new Error("请输入订单号");
    if(dialogState.kind==='receive' && !dialogState.order) {
      const result=await api(`/station/orders/${encodeURIComponent(orderId)}/picking`,{method:"POST",body:"{}"});
      dialogState.order=result.order;dialogState.claimed=true;render();return;
    }
    if(!dialogState.attempt) {
      if(dialogState.kind==='receive') {
        const items=dialogState.order.pickingItems || [];
        body.receivedItems=items.map(item=>({productId:item.productId, quantity:Number(body[`quantity_${item.productId}`]), barcode:body[`barcode_${item.productId}`]||""}));
        if(body.condition==="normal" && items.some((item,i)=>body[`quantity_${item.productId}`]==="" || body.receivedItems[i].quantity!==item.quantity)) throw new Error("实收数量不一致，请核对或选择异常货物状态");
        if(body.condition==="normal" && items.some((item,i)=>(state.dashboard?.pickingConfig?.scanRequired || body.receivedItems[i].barcode) && (!item.barcode || body.receivedItems[i].barcode!==item.barcode))) throw new Error("商品条码不匹配或未核对，请重新扫码");
        items.forEach(item=>{delete body[`quantity_${item.productId}`];delete body[`barcode_${item.productId}`];});
      }
      body.idempotencyKey=`station_${dialogState.kind}_${orderId}_${Date.now()}`;
      dialogState.attempt=body;
    }
    const action=dialogState.kind==='receive'?'receive':dialogState.kind==='pickup'?'pickup-verify':'exceptions';
    await api(`/station/orders/${encodeURIComponent(orderId)}/${action}`,{method:"POST",body:JSON.stringify(body)});
    toast(action==='receive' && body.condition==="normal"?"收货成功":action==='pickup-verify'?"提货核验成功":"异常已登记");
    state.dialog=null;await load();
  } catch(e) {
    if([400,404,409].includes(e.status)) dialogState.attempt=null;
    if(dialogState.attempt) {
      [...form.elements].forEach(el=>{if(el!==submit)el.disabled=true;});
      if(submit)submit.textContent="重试原操作";
    }
    toast(e.message);
  } finally {state.submitting=false;if(submit?.isConnected)submit.disabled=false;}
}
render(); if(state.token) load();
