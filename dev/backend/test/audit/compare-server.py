"""Compare tracked code only; never download environment files or business data."""
import base64
import hashlib
import json
import pathlib
import re
import subprocess

import paramiko

ROOT = pathlib.Path(__file__).resolve().parents[4]
REMOTE = "/www/wwwroot/tgg_shop"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode("utf-8").strip()


def fingerprint(data):
    try:
        normalized = data.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
    except UnicodeDecodeError:
        normalized = data
    return {"sha256": hashlib.sha256(data).hexdigest(),
            "normalized": hashlib.sha256(normalized).hexdigest(), "bytes": len(data)}


def parse_api(raw):
    code = "const d=require('./node_modules/yaml').parse(require('fs').readFileSync(0,'utf8')); console.log(JSON.stringify(Object.entries(d.paths).flatMap(([path,v])=>Object.entries(v).filter(([m])=>['get','post','put','patch','delete','head','options'].includes(m)).map(([method,x])=>({path,method:method.toUpperCase(),summary:x.summary||'',tags:x.tags||[],security:x.security??d.security??[],responses:Object.keys(x.responses||{})})))));"
    return json.loads(subprocess.check_output(["node", "-e", code], cwd=ROOT / "dev/backend", input=raw))


def main():
    lines = (ROOT / "server.txt").read_text(encoding="utf-8-sig").splitlines()
    values = [re.split(r"[:\uff1a=]", line, maxsplit=1)[1].strip()
              for line in lines if re.search(r"[:\uff1a=]", line)]
    ssh = paramiko.SSHClient()
    ssh.load_system_host_keys(str(pathlib.Path.home() / ".ssh" / "known_hosts"))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        ssh.connect(values[0], username=values[1], password=values[2], timeout=15,
                    look_for_keys=False, allow_agent=False)
        remote_code = '''import pathlib,subprocess,json,hashlib,datetime
root=pathlib.Path("/www/wwwroot/tgg_shop")
def git(*args): return subprocess.check_output(["git",*args],cwd=root).decode("utf-8").strip()
files={}
for name in git("ls-files","-z").split("\\0"):
 if not name: continue
 p=root/name
 if not p.is_file(): files[name]={"missing":True}; continue
 data=p.read_bytes()
 try: normalized=data.decode("utf-8").replace("\\r\\n","\\n").encode("utf-8")
 except UnicodeDecodeError: normalized=data
 files[name]={"sha256":hashlib.sha256(data).hexdigest(),"normalized":hashlib.sha256(normalized).hexdigest(),"bytes":len(data)}
print(json.dumps({"checkedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"head":git("rev-parse","HEAD"),"status":git("status","--porcelain"),"files":files}))
'''
        encoded = base64.b64encode(remote_code.encode()).decode("ascii")
        _, stdout, stderr = ssh.exec_command("python3 -c \"import base64;exec(base64.b64decode('" + encoded + "'))\"", timeout=90)
        remote = json.loads(stdout.read())
        if stdout.channel.recv_exit_status():
            raise RuntimeError("Remote tracked-file inventory failed")
        with ssh.open_sftp() as sftp:
            remote_api = parse_api(sftp.open(REMOTE + "/dev/backend/openapi.yaml", "rb").read())
            remote_pages = json.loads(sftp.open(REMOTE + "/wechat-miniprogram/app.json", "rb").read())["pages"]
        local_names = git("ls-files", "-z").split("\0")
        local = {name: fingerprint((ROOT / name).read_bytes()) if (ROOT / name).is_file() else {"missing": True}
                 for name in local_names if name}
        differences, equal, newline_only = [], 0, 0
        for name in sorted(set(local) | set(remote["files"])):
            left, right = remote["files"].get(name), local.get(name)
            if left == right:
                equal += 1
            elif left and right and left.get("normalized") == right.get("normalized"):
                newline_only += 1
            else:
                differences.append({"path": name, "kind": "local-only" if left is None else "server-only" if right is None else "changed", "server": left, "local": right})
        local_api = parse_api((ROOT / "dev/backend/openapi.yaml").read_bytes())
        result = {"checkedAt": remote["checkedAt"], "localHead": git("rev-parse", "HEAD"),
                  "serverHead": remote["head"], "serverWorktree": remote["status"],
                  "localWorktree": git("status", "--porcelain"),
                  "commitsServerToLocal": git("log", "--oneline", remote["head"] + "..HEAD"),
                  "committedDiffStat": git("diff", "--stat", remote["head"], "HEAD"),
                  "tracked": {"server": len(remote["files"]), "local": len(local), "identicalBytes": equal, "newlineOnly": newline_only, "contentDifferences": len(differences)},
                  "differences": differences, "serverOperations": remote_api, "localOperations": local_api,
                  "serverMiniPages": remote_pages,
                  "localMiniPages": json.loads((ROOT / "wechat-miniprogram/app.json").read_bytes())["pages"]}
        out = ROOT / "dev/backend/test/audit/artifacts"
        out.mkdir(exist_ok=True)
        (out / "server-comparison-2026-10-13.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({k: result[k] for k in ["checkedAt", "localHead", "serverHead", "serverWorktree", "commitsServerToLocal", "tracked"]}, ensure_ascii=True))
        print(json.dumps({"serverOperations": len(remote_api), "localOperations": len(local_api), "serverMiniPages": len(remote_pages), "localMiniPages": len(result["localMiniPages"]), "differencePaths": [d["path"] for d in differences]}, ensure_ascii=True))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
