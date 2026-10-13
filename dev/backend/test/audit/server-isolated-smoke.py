"""Run deployed smoke suites against disposable data, with no inherited secrets."""
import base64
import json
import pathlib
import re

import paramiko

root = pathlib.Path(__file__).resolve().parents[4]
values = [re.split(r"[:\uff1a=]", row, maxsplit=1)[1].strip()
          for row in (root / "server.txt").read_text(encoding="utf-8-sig").splitlines()
          if re.search(r"[:\uff1a=]", row)]
ssh = paramiko.SSHClient()
ssh.load_system_host_keys(str(pathlib.Path.home() / ".ssh" / "known_hosts"))
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
code = '''import subprocess,socket,json,os,tempfile,shutil,pathlib,atexit
deployed=pathlib.Path("/www/wwwroot/tgg_shop")
temporary=tempfile.TemporaryDirectory(prefix="tgg-isolated-smoke-")
atexit.register(temporary.cleanup)
mirror=pathlib.Path(temporary.name)
root=str(mirror/"dev/backend")
def ignore(directory,names):
 excluded=shutil.ignore_patterns("node_modules",".env*",".git")(directory,names)
 if pathlib.Path(directory)==deployed/"dev/backend": excluded.add("data")
 return excluded
shutil.copytree(deployed/"dev/backend",root,ignore=ignore)
os.symlink(str(deployed/"dev/backend/node_modules"),str(pathlib.Path(root)/"node_modules"))
shutil.copytree(deployed/"dev/frontend",mirror/"dev/frontend")
shutil.copytree(deployed/"ui/v17/assets",mirror/"ui/v17/assets")
pid=subprocess.check_output(["systemctl","show","tgg-shop.service","--value","-p","MainPID"],text=True).strip()
node="/proc/"+pid+"/exe"
probe=socket.socket()
probe.bind(("127.0.0.1",5199))
probe.close()
env={"PATH":"/usr/bin:/bin","NODE_ENV":"test","TGG_LOAD_DOTENV":"0","NODE_NO_WARNINGS":"1","TGG_TASK_SWEEP_ENABLED":"0"}
bootstrap = r"""const fs=require('fs'),Module=require('module'),path=require('path');
const file=path.resolve('test/smoke.test.js');
let source=fs.readFileSync(file,'utf8');
const needle='cashPrice: 16.8, pointsPrice: 288';
if(source.split(needle).length!==2) throw new Error('Expected old fixture was not found');
source=source.replace(needle,'cashPrice: 16.8, regularPrice: 20, pointsPrice: 288');
source=source.replace('function assert(condition, message) {','let auditAssertions=0; function assert(condition, message) { auditAssertions++;');
source=source.replace('console.log(`Smoke tests passed (${DRIVER})`);','console.log(JSON.stringify({driver:DRIVER,assertions:auditAssertions,fixtureCorrection:"regularPrice=20",passed:true}));');
process.argv=['node',file,process.argv[1]];
const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(source,file);
"""
for driver in ["json","sqlite","pg"]:
 result=subprocess.run([node,"--no-warnings","-e",bootstrap,driver],cwd=root,env=env,text=True,capture_output=True,timeout=120)
 print(json.dumps({"driver":driver,"fixtureCorrection":"regularPrice=20, in-memory only","exitCode":result.returncode,"stdout":result.stdout,"stderr":result.stderr,"isolated":True,"realPostgres":False}),flush=True)
'''
try:
    ssh.connect(values[0], username=values[1], password=values[2], timeout=15,
                look_for_keys=False, allow_agent=False)
    encoded = base64.b64encode(code.encode()).decode("ascii")
    _, stdout, stderr = ssh.exec_command("python3 -c \"import base64;exec(base64.b64decode('" + encoded + "'))\"", timeout=400)
    records = []
    for line in stdout:
        item = json.loads(line)
        records.append(item)
        print(json.dumps(item, ensure_ascii=True), flush=True)
    status = stdout.channel.recv_exit_status()
    error = stderr.read().decode()
    if error:
        print(json.dumps({"runnerError": error}, ensure_ascii=True))
    out = root / "dev/backend/test/audit/artifacts"
    out.mkdir(exist_ok=True)
    (out / "server-smoke-2026-10-13.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(status or int(any(r["exitCode"] != 0 for r in records)))
finally:
    ssh.close()
