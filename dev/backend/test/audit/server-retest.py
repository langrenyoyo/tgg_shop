"""Rerun deployed suites in a disposable checkout and save dated evidence."""
import datetime
import json
import pathlib
import re
import sys
from zoneinfo import ZoneInfo

import paramiko

ROOT = pathlib.Path(__file__).resolve().parents[4]
STAMP = datetime.datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
OUT = ROOT / "dev/backend/test/audit/artifacts" / STAMP
OUT.mkdir(exist_ok=True)
values = [re.split(r"[:\uff1a=]", line, maxsplit=1)[1].strip()
          for line in (ROOT / "server.txt").read_text(encoding="utf-8-sig").splitlines()
          if re.search(r"[:\uff1a=]", line)]
remote = r'''
import subprocess,socket,json,os,tempfile,shutil,pathlib,signal,time,pwd
deployed=pathlib.Path('/www/wwwroot/tgg_shop')
pid=subprocess.check_output(['systemctl','show','tgg-shop.service','--value','-p','MainPID'],text=True).strip()
node='/proc/'+pid+'/exe'
def emit(value): print(json.dumps(value),flush=True)
emit({'kind':'version','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=deployed,text=True).strip(),'worktree':subprocess.check_output(['git','status','--short'],cwd=deployed,text=True).strip()})
with tempfile.TemporaryDirectory(prefix='tgg-retest-') as temporary:
 mirror=pathlib.Path(temporary)
 root=mirror/'dev/backend'
 def ignore(directory,names):
  ignored=shutil.ignore_patterns('node_modules','.env*','.git')(directory,names)
  if pathlib.Path(directory)==deployed/'dev/backend': ignored.add('data')
  return ignored
 shutil.copytree(deployed/'dev/backend',root,ignore=ignore)
 shutil.copy2(deployed/'dev/backend/.env.example',root/'.env.example')
 os.symlink(str(deployed/'dev/backend/node_modules'),str(root/'node_modules'))
 shutil.copytree(deployed/'dev/frontend',mirror/'dev/frontend')
 shutil.copytree(deployed/'ui/v17/assets',mirror/'ui/v17/assets')
 shutil.copytree(deployed/'wechat-miniprogram',mirror/'wechat-miniprogram')
 shutil.copytree(deployed/'app',mirror/'app')
 base={'PATH':'/usr/bin:/bin','NODE_ENV':'test','TGG_LOAD_DOTENV':'0','NODE_NO_WARNINGS':'1','TGG_TASK_SWEEP_ENABLED':'0'}
 def run(name,args,memory=False,extra=None):
  if selected and name not in selected:return
  env=dict(base)
  if memory: env.update(TGG_STORE_MODE='memory',TGG_STORE_DRIVER='json')
  if extra:env.update(extra)
  started=time.monotonic()
  proc=subprocess.Popen([node,'--no-warnings',*args],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
  timedout=False
  try: out,err=proc.communicate(timeout=100)
  except subprocess.TimeoutExpired:
   timedout=True
   os.killpg(proc.pid,signal.SIGKILL)
   out,err=proc.communicate()
  finally:
   try: os.killpg(proc.pid,signal.SIGTERM)
   except ProcessLookupError: pass
  emit({'kind':'suite','name':name,'exitCode':proc.returncode,'timedOut':timedout,'elapsedSeconds':round(time.monotonic()-started,2),'stdout':out,'stderr':err})
 run('migrations',['scripts/check-migrations.js'])
 run('openapi',['scripts/check-openapi.js'])
 files=sorted(str(p.relative_to(root)) for pattern in ['test/unit/*.test.js','test/audit/*.test.js'] for p in root.glob(pattern))
 run('unit',['--test',*files],True)
 run('business-boundaries',['--test','test/audit/readiness-audit.js'],True)
 run('business-e2e',['--test','test/e2e/business-closure-api.test.js'],True)
 for driver in ['json','sqlite','pg']:
  if selected and 'smoke-'+driver not in selected:continue
  with socket.socket() as probe:
   probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
   probe.bind(('127.0.0.1',5199))
  run('smoke-'+driver,['test/smoke.test.js',driver])
 if not selected or any(name in selected for name in ['smoke-pg-real','backup-restore']):
  pgBin=pathlib.Path('/www/server/pgsql/bin')
  pgTemp=pathlib.Path(tempfile.mkdtemp(prefix='tgg-retest-pg-'))
  account=pwd.getpwnam('www')
  os.chown(pgTemp,account.pw_uid,account.pw_gid)
  with socket.socket() as probe:
   probe.bind(('127.0.0.1',0));pgPort=probe.getsockname()[1]
  prefix=['runuser','-u','www','--']
  started=False
  try:
   subprocess.run([*prefix,str(pgBin/'initdb'),'-D',str(pgTemp/'data'),'-U','audit_postgres','-A','trust','--no-locale','-E','UTF8'],check=True,capture_output=True,timeout=40)
   subprocess.run([*prefix,str(pgBin/'pg_ctl'),'-D',str(pgTemp/'data'),'-l',str(pgTemp/'server.log'),'-o',f'-h 127.0.0.1 -p {pgPort} -k {pgTemp} -F','-w','start'],check=True,capture_output=True,timeout=40)
   started=True
   run('smoke-pg-real',['test/smoke.test.js','pg'],extra={'TGG_PG_URL':f'postgresql://audit_postgres@127.0.0.1:{pgPort}/postgres','TGG_PG_STATE_ID':'isolated_audit'})
   if 'backup-restore' in selected:
    backup=pathlib.Path('/www/backup/tgg-shop/deploy-20261014/database.dump')
    assert backup.is_file(),'Deployment backup missing'
    startedAt=time.monotonic()
    restore=subprocess.run([str(pgBin/'pg_restore'),'-h','127.0.0.1','-p',str(pgPort),'-U','audit_postgres','-d','postgres','--no-owner','--no-acl','--exit-on-error',str(backup)],env=base,capture_output=True,text=True,timeout=60)
    result={'kind':'suite','name':'backup-restore','exitCode':restore.returncode,'elapsedSeconds':round(time.monotonic()-startedAt,2),'archiveBytes':backup.stat().st_size,'stdout':'','stderr':''}
    if restore.returncode==0:
     sql="SELECT json_build_object('stateRows',count(*),'users',max(jsonb_array_length(state_json::jsonb->'users')),'orders',max(jsonb_array_length(state_json::jsonb->'orders')),'paymentLedger',max(jsonb_array_length(state_json::jsonb->'paymentLedger')),'withdrawRequests',max(jsonb_array_length(state_json::jsonb->'withdrawRequests'))) FROM public.app_state"
     checked=subprocess.check_output([str(pgBin/'psql'),'-h','127.0.0.1','-p',str(pgPort),'-U','audit_postgres','-d','postgres','-tAc',sql],env=base,text=True,timeout=15)
     result['restoredCounts']=json.loads(checked)
     assert result['restoredCounts']['stateRows']>=1,'Restored state missing'
    else:result['stderr']='pg_restore failed; inspect the temporary instance before repeating'
    emit(result)
  finally:
   if started:subprocess.run([*prefix,str(pgBin/'pg_ctl'),'-D',str(pgTemp/'data'),'-m','fast','-w','stop'],check=True,capture_output=True,timeout=40)
   shutil.rmtree(pgTemp)
   emit({'kind':'pg-cleanup','isolatedPostgresStopped':True,'temporaryClusterRemoved':not pgTemp.exists()})
emit({'kind':'cleanup','temporaryCheckoutRemoved':not pathlib.Path(temporary).exists()})
'''
ssh = paramiko.SSHClient()
ssh.load_system_host_keys(str(pathlib.Path.home() / ".ssh" / "known_hosts"))
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
    ssh.connect(values[0], username=values[1], password=values[2], timeout=15,
                look_for_keys=False, allow_agent=False)
    mode = sys.argv[1] if len(sys.argv) > 1 else "isolated"
    records = []
    if mode == "live":
        _, stdout, _ = ssh.exec_command("systemctl show tgg-shop.service --value -p MainPID", timeout=15)
        pid = stdout.read().decode().strip()
        assert pid.isdigit() and pid != "0"
        stdin, stdout, stderr = ssh.exec_command(f"/proc/{pid}/exe -", timeout=240)
        source = pathlib.Path(__file__).with_name("server-readiness-remote.js").read_text(encoding="utf-8")
    else:
        assert mode == "isolated"
        stdin, stdout, stderr = ssh.exec_command("python3 -", timeout=1000)
        selected = sys.argv[2:]
        source = "selected=" + repr(selected) + "\n" + remote
    stdin.write(source)
    stdin.flush()
    stdin.channel.shutdown_write()
    for line in stdout:
        record = json.loads(line)
        records.append(record)
        if record.get("kind") == "suite":
            summary = {key: value for key, value in record.items() if key not in ["stdout", "stderr"]}
            summary["tail"] = record["stdout"][-1200:]
            summary["stderr"] = record["stderr"][-1200:]
            print(json.dumps(summary, ensure_ascii=True), flush=True)
        else:
            print(json.dumps(record, ensure_ascii=True), flush=True)
    status = stdout.channel.recv_exit_status()
    error = stderr.read().decode()
    if error:
        records.append({"runnerError": error})
        print(json.dumps(records[-1], ensure_ascii=True))
    suffix = "-" + "-".join(sys.argv[2:]) if mode == "isolated" and sys.argv[2:] else ""
    (OUT / (mode + suffix + ".json")).write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(status or int(any(row.get("exitCode", 0) != 0 for row in records)))
finally:
    ssh.close()
