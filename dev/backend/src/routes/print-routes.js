const admin = require("../services/admin-service");
const printing = require("../services/print-service");
async function handlePrintRoutes(ctx) {
  const {req,url,state,send,res,readBody}=ctx;
  if(!url.pathname.startsWith("/api/admin/printing")) return false;
  const device=url.pathname.match(/^\/api\/admin\/printing\/printers(?:\/([^/]+)(?:\/(register|status|test))?)?$/);
  const order=url.pathname.match(/^\/api\/admin\/printing\/orders\/([^/]+)$/);
  const job=url.pathname.match(/^\/api\/admin\/printing\/jobs\/([^/]+)\/(query|retry|cancel|resolve)$/);
  const permission=device ? "config:write" : req.method==="GET" ? "order:read" : "order:fulfillment";
  const auth=admin.requirePermission(req,state,permission);
  if(!auth.ok) return send(res,auth.status,{error:auth.error});
  if(req.method==="GET" && url.pathname==="/api/admin/printing") return send(res,200,printing.summary(state));
  let result;
  if(device && req.method==="POST" && !device[1]) result=await printing.savePrinter(state,null,await readBody(req),auth.adminId);
  else if(device && req.method==="PATCH" && device[1] && !device[2]) result=await printing.savePrinter(state,device[1],await readBody(req),auth.adminId);
  else if(device && req.method==="POST" && device[2]) {
    result=device[2]==="test" ? await printing.testPage(state,device[1],await readBody(req),auth.adminId) : await printing.deviceAction(state,device[1],device[2],{},auth.adminId);
  } else if(order && req.method==="POST") result=await printing.requestPrint(state,order[1],await readBody(req),auth.adminId);
  else if(job && req.method==="POST") result=await printing.jobAction(state,job[1],job[2],await readBody(req),auth.adminId);
  else return send(res,404,{error:"打印接口不存在"});
  if(!result.ok) return send(res,result.status,{error:result.error});
  const {content,key,...publicJob}=result.job||{};
  return send(res,200,result.job?{...result,job:publicJob}:result);
}
module.exports={handlePrintRoutes};
