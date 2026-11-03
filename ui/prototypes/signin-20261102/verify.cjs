// Runs the standalone prototype in local headless Edge, checks its main paths,
// and exports review screenshots. No production services are contacted.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.join(__dirname,name==='/'?'index.html':path.basename(name));if(!['index.html','style.css','app.js'].includes(path.basename(file))){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tgg-signin-prototype-'));
 const executable=process.env.PROTOTYPE_BROWSER||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
 const browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-allow-origins=*','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 let ws;
 try {
  let port;
  for(let n=0;n<100;n++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{await delay(100);}}
  assert.ok(port,'Browser debugging endpoint');
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map(),errors=[];
  ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const pair=pending.get(msg.id);pending.delete(msg.id);msg.error?pair.reject(msg.error):pair.resolve(msg.result);}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const seq=++id;pending.set(seq,{resolve,reject});ws.send(JSON.stringify({id:seq,method,params}));});
  await send('Page.enable');await send('Runtime.enable');
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const waitFor=async expression=>{for(let n=0;n<70;n++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression);};
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1090,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base});await waitFor('Boolean(document.querySelector("#screen .reward-card"))');
  const out=path.resolve(__dirname,'../../v17/UI');fs.mkdirSync(out,{recursive:true});
  let shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(out,'signin-interactive-20261102.png'),Buffer.from(shot.data,'base64'));
  await click('#overviewToggle');await send('Emulation.setDeviceMetricsOverride',{width:1850,height:970,deviceScaleFactor:1,mobile:false});await delay(200);
  shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(out,'signin-flow-20261102.png'),Buffer.from(shot.data,'base64'));
  await click('#overviewToggle');
  await evaluate(`document.querySelector('[name="minRounds"]').value=2;document.querySelector('[name="maxRounds"]').value=2;document.querySelector('[name="interval"]').value=0;document.querySelector('[name="reward"]').value=12;document.querySelector('#settings').requestSubmit();`);await click('#resetDemo');
  await click('[data-action="open"]');await click('[data-action="get"]');
  for(let i=0;i<3;i++)await click('[data-action="adComplete"]');
  assert.equal(await evaluate('run.completed'),1,'Whole ad group counts once');
  await click('[data-action="get"]');await click('[data-action="adComplete"]');await click('[data-action="exit"]');await click('[data-action="cancelExit"]');assert.equal(await evaluate('adIndex'),1,'Cancel exit resumes same ad');
  await click('[data-action="exit"]');await click('[data-action="confirmExit"]');assert.equal(await evaluate('run.completed'),1,'Completed rounds retained');
  await send('Page.reload');await waitFor('Boolean(document.querySelector("[data-action=open]"))');assert.equal(await evaluate('run.completed'),1,'Progress survives reopen');assert.equal(await evaluate('run.config.rounds'),2,'Random target survives reopen');
  await click('[data-action="open"]');await click('[data-action="get"]');assert.equal(await evaluate('adIndex'),0,'Partial group restarted');await click('[data-action="adFail"]');assert.equal(await evaluate('run.completed'),1);await click('[data-action="retryAd"]');await click('[data-action="get"]');for(let i=0;i<3;i++)await click('[data-action="adComplete"]');
  await click('[data-action="claim"]');await waitFor('scene==="success"');assert.equal(await evaluate('balance'),268);await evaluate('action("claim");settle();');assert.equal(await evaluate('balance'),268,'Award only once');await click('[data-action="backHome"]');assert.equal(await evaluate('document.querySelector("[data-action=open]").disabled'),true);
  await click('#resetDemo');await click('#uncertainReward');await click('[data-action="backHome"]');await click('[data-action="open"]');assert.equal(await evaluate('scene'),'uncertain');await click('[data-action="queryReward"]');assert.equal(await evaluate('balance'),268);
  await click('#resetDemo');await click('[data-action="open"]');await evaluate(`document.querySelector('[name="reward"]').value=33;document.querySelector('#settings').requestSubmit()`);assert.equal(await evaluate('active().reward'),12,'Config snapshot preserved');
  const randomTargets=await evaluate(`(()=>{const savedRandom=Math.random;const targets=[];for(const value of [0,0.5,0.999999]){run=null;cfg.minRounds=2;cfg.maxRounds=4;Math.random=()=>value;ensureRun();targets.push(run.config.rounds);Math.random=()=>0;ensureRun();if(run.config.rounds!==targets.at(-1))throw Error('Target rerolled');}Math.random=savedRandom;return targets;})()`);
  assert.deepEqual(randomTargets,[2,3,4],'Inclusive random integer endpoints and stable resume');
  await evaluate(`document.querySelector('[name="minRounds"]').value=5;document.querySelector('[name="maxRounds"]').value=2;document.querySelector('#settings').requestSubmit()`);
  assert.equal(await evaluate('cfg.minRounds'),2,'Invalid range cannot change saved config');
  assert.equal(await evaluate('cfg.exitPolicy'),'keep','Confirmed exit policy');assert.equal(await evaluate('cfg.unit'),'金币','Confirmed reward name');assert.equal(await evaluate('document.querySelector("[name=unit]").readOnly'),true);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(150);assert.equal(await evaluate('document.documentElement.scrollWidth<=390'),true,'Mobile layout fits viewport');
  assert.deepEqual(errors,[]);console.log('PASS: normal rounds, exit/cancel/resume, reload, ad retry, once-only claim, uncertain result, config snapshot, confirmed rules, mobile layout.');console.log('Screenshots: '+out);
 } finally {if(ws)ws.close();browser.kill();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
