const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const labels = { queued:"待发送", sending:"发送中", accepted:"云端排队", printed:"已打印", failed:"发送失败", unknown:"发送结果待核对", unconfirmed:"出纸结果待核对", cancelled:"已取消" };
const can = (state, permission) => state.identity?.permissions?.some(p => p === "*" || p === permission);
export function printingView(state) {
  const data=state.printing;
  if(!data) return `<section class="panel"><p role="alert">${esc(state.printingError || "打印管理加载失败，请刷新重试")}</p></section>`;
  const edit=data.printers.find(p=>p.id===state.printEditId) || {};
  const config=can(state,"config:write"), write=can(state,"order:fulfillment");
  const statusText=printer=>({0:"离线",1:"在线",2:"在线异常（请检查纸张）"}[printer.deviceStatus] || "未查询");
  const buttons=(id,actions,disabled=false)=>actions.map(([action,label])=>`<button type="button" class="action muted-action" data-print-action="${action}" data-print-id="${esc(id)}" ${disabled?"disabled":""}>${label}</button>`).join(" ");
  return `<div class="print-management">
  <section class="panel"><div class="panel-head"><h2>芯烨云小票打印</h2><button class="action muted-action" data-print-action="refresh">刷新状态</button></div><p>${data.configured?"账号已配置":"账号未配置，请由服务器管理员设置芯烨云账号密钥"} · ${data.enabled?"发送服务已开启":"发送服务未开启，任务会保留在本地队列"}</p><p>80mm 小票机优先。付款成功后按站点自动生成小票；补打和异常核对均保留操作记录。</p>${data.workerError?`<p role="alert">${esc(data.workerError)}</p>`:""}${state.printMessage?`<p role="status">${esc(state.printMessage)}</p>`:""}</section>
  ${config?`<section class="panel"><h3>${edit.id?"编辑打印机":"新增打印机"}</h3><form class="print-form" data-print-printer="${esc(edit.id || "")}">
  <label>设备名称<input name="name" maxlength="50" required value="${esc(edit.name)}"></label>
  <label>芯烨云设备编号 SN/PID<input name="sn" required ${edit.id?"readonly":""} value="${esc(edit.sn)}" placeholder="打印机底部标签上的编号"></label>
  <label>用途<select name="fulfillmentType"><option value="pickup" ${edit.fulfillmentType!=="delivery"?"selected":""}>自提订单</option><option value="delivery" ${edit.fulfillmentType==="delivery"?"selected":""}>配送订单</option></select></label>
  <label>所属自提点<select name="siteId"><option value="">配送用途无需选择</option>${data.sites.map(s=>`<option value="${esc(s.id)}" ${edit.siteId===s.id?"selected":""}>${esc(s.name)}</option>`).join("")}</select></label>
  <label>纸宽<select name="paperWidth"><option value="80" ${edit.paperWidth!==58?"selected":""}>80mm</option><option value="58" ${edit.paperWidth===58?"selected":""}>58mm</option></select></label>
  <label>打印份数<input type="number" min="1" max="5" name="copies" value="${edit.copies || 1}" required></label>
  <label>小票店名<input name="shopName" maxlength="40" value="${esc(edit.shopName || "TGG Shop")}"></label><label>底部文案<input name="footer" maxlength="120" value="${esc(edit.footer || "请核对商品与数量")}"></label>
  <label class="print-check"><input type="checkbox" name="enabled" ${edit.enabled?"checked":""}>启用设备</label><label class="print-check"><input type="checkbox" name="autoPrint" ${edit.autoPrint?"checked":""}>支付后自动打印（仅新支付订单）</label>
  <label>操作原因<input name="reason" maxlength="200" required></label><div class="table-actions"><button class="action" type="submit">保存</button><button type="button" class="action muted-action" data-print-action="new">清空表单</button></div>
  </form></section>`:""}
  <section class="table-panel"><h3>打印设备</h3><div class="print-scroll"><table><thead><tr><th>设备</th><th>用途 / 站点</th><th>规则</th><th>状态</th><th>操作</th></tr></thead><tbody>${data.printers.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.sn)}</small></td><td>${p.fulfillmentType==="delivery"?"配送":esc(data.sites.find(s=>s.id===p.siteId)?.name || p.siteId)}</td><td>${p.paperWidth}mm · ${p.copies}份<br>${p.autoPrint?"自动打印":"手动打印"}</td><td>${p.enabled?"启用":"停用"} · ${p.registered?"已验证":"待注册/验证"}<br>${statusText(p)}</td><td><div class="table-actions">${buttons(p.id,[["edit","编辑"],["register","注册设备"],["status","检查状态"],["test","打印测试页"]],!config)}</div></td></tr>`).join("") || '<tr><td colspan="5">尚未添加设备</td></tr>'}</tbody></table></div><p>设备已在芯烨云账号下绑定时，可直接“检查状态”验证。停用不会清除云端已接收的打印任务。</p></section>
  ${write?`<section class="panel"><h3>订单打印 / 补打</h3><form class="print-form" data-print-order>
  <label>订单编号<input name="orderId" value="${esc(state.printOrderId)}" required placeholder="商城商品订单编号"></label>
  <label>打印机<select name="printerId" required><option value="">请选择</option>${data.printers.filter(p=>p.enabled).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
  <label>操作原因<input name="reason" required maxlength="200" placeholder="首次打印或补打原因"></label><label class="print-check"><input name="reprint" type="checkbox">确认补打已打印订单</label><button type="submit" class="action">提交打印任务</button></form></section>`:""}
  <section class="table-panel"><h3>打印任务（最近200条，共${data.totalJobs}条）</h3><p>点击后台刷新获取最新状态。结果未知的任务请先核对芯烨云后台和实际纸张，再操作补打。</p><div class="print-scroll"><table><thead><tr><th>订单 / 任务</th><th>设备</th><th>状态</th><th>时间 / 原因</th><th>操作</th></tr></thead><tbody>${data.jobs.map(j=>`<tr><td>${esc(j.orderId || "设备测试页")} ${j.test?'<strong class="print-test">测试</strong>':""}${j.reprint?" · 补打":""}<br><small>${esc(j.id)}</small><br><small>云端：${esc(j.providerOrderId || "尚无任务号")}</small></td><td>${esc(data.printers.find(p=>p.id===j.printerId)?.name || j.printerId)}</td><td><strong>${esc(labels[j.status] || j.status)}</strong><br>${esc(j.error)}</td><td>${esc(j.createdAt)}<br>${esc(j.reason)}</td><td><div class="table-actions">${buttons(j.id,[...(j.providerOrderId?[["query","查询出纸"]]:[]),...(["queued","failed"].includes(j.status)&&!j.providerOrderId?[["cancel","取消"]]:[]),...(["failed","cancelled"].includes(j.status)&&!j.providerOrderId?[["retry","重试"]]:[]),...(["unknown","unconfirmed"].includes(j.status)?[["resolve","人工核对"]]:[])],!write)}</div></td></tr>`).join("") || '<tr><td colspan="5">暂无任务</td></tr>'}</tbody></table></div></section></div>`;
}
export function printingClick(event,state,{api,render,reload}) {
  const order=event.target.closest("[data-print-order-id]");
  if(order) {state.printOrderId=order.dataset.printOrderId;state.view="printing";render(state);return true;}
  const button=event.target.closest("[data-print-action]");
  if(!button || button.disabled) return Boolean(button);
  const {printAction:action,printId:id}=button.dataset;
  if(action==="refresh") {button.disabled=true;reload().catch(e=>window.alert(e.message)).finally(()=>{button.disabled=false;});return true;}
  if(action==="edit" || action==="new") {state.printEditId=action==="edit"?id:null;render(state);return true;}
  let body={},path;
  if(["register","status","test"].includes(action)) {
    path=`/api/admin/printing/printers/${encodeURIComponent(id)}/${action}`;
    if(action==="test") {if(!window.confirm("确认打印一张测试页？"))return true; body.idempotencyKey=button.dataset.requestKey ||= crypto.randomUUID();}
  } else {
    path=`/api/admin/printing/jobs/${encodeURIComponent(id)}/${action}`;
    if(action!=="query") {body.reason=window.prompt("请输入操作原因；结果未知时请先核对云端任务和实际出纸：");if(!body.reason?.trim())return true;}
    if(action==="resolve") {
      const result=window.prompt("已出纸请输入“已打印”；确认未出纸且云端已无待打印任务请输入“已清除”");
      if(!["已打印","已清除"].includes(result))return true;
      body.outcome=result==="已打印"?"printed":"cancelled";body.confirmCloudCleared=result==="已清除";
    }
  }
  button.disabled=true;
  api(path,{method:"POST",body:JSON.stringify(body)}).then(()=>{state.printMessage="操作已保存，请查看设备或任务状态";return reload();}).catch(e=>window.alert(e.message)).finally(()=>{button.disabled=false;});
  return true;
}
export function printingSubmit(event,state,{api,reload}) {
  const form=event.target.closest("[data-print-printer], [data-print-order]");
  if(!form)return false;
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return true;
  const fields=new FormData(form);let path,method,body;
  if(form.hasAttribute("data-print-printer")) {
    const id=form.dataset.printPrinter;path=`/api/admin/printing/printers${id?"/"+encodeURIComponent(id):""}`;method=id?"PATCH":"POST";
    body={...Object.fromEntries(fields),copies:Number(fields.get("copies")),paperWidth:Number(fields.get("paperWidth")),enabled:fields.get("enabled")==="on",autoPrint:fields.get("autoPrint")==="on"};
  } else {
    path=`/api/admin/printing/orders/${encodeURIComponent(fields.get("orderId"))}`;method="POST";
    const intent={printerId:fields.get("printerId"),reason:fields.get("reason"),reprint:fields.get("reprint")==="on"};
    const encoded=JSON.stringify({path,...intent});
    if(form.dataset.intent!==encoded){form.dataset.intent=encoded;form.dataset.requestKey=crypto.randomUUID();}
    body={...intent,idempotencyKey:form.dataset.requestKey};
  }
  button.disabled=true;
  api(path,{method,body:JSON.stringify(body)}).then(()=>{state.printEditId=null;state.printMessage="已保存，打印任务将由后台发送";return reload();}).catch(e=>window.alert(e.message)).finally(()=>{button.disabled=false;});
  return true;
}
