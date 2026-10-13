"""Run a fixed, read-only remote audit; credentials never enter command arguments."""
import base64
import pathlib
import re

import paramiko

root = pathlib.Path(__file__).resolve().parents[4]
lines = (root / "server.txt").read_text(encoding="utf-8-sig").splitlines()
values = [re.split(r"[:\uff1a=]", line, maxsplit=1)[1].strip()
          for line in lines if re.search(r"[:\uff1a=]", line)]
script = pathlib.Path(__file__).with_name("server-readiness-remote.js").read_bytes()
ssh = paramiko.SSHClient()
ssh.load_system_host_keys(str(pathlib.Path.home() / ".ssh" / "known_hosts"))
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
    ssh.connect(values[0], username=values[1], password=values[2], timeout=15,
                look_for_keys=False, allow_agent=False)
    _, stdout, _ = ssh.exec_command("systemctl show tgg-shop.service --value -p MainPID", timeout=15)
    pid = stdout.read().decode().strip()
    if not pid.isdigit() or pid == "0":
        raise RuntimeError("Backend is not running")
    encoded = base64.b64encode(script).decode("ascii")
    command = f"/proc/{pid}/exe -e \"eval(Buffer.from('{encoded}','base64').toString())\""
    _, stdout, stderr = ssh.exec_command(command, timeout=240)
    records = []
    for line in stdout:
        records.append(line)
        print(line.rstrip(), flush=True)
    error = stderr.read().decode()
    if error:
        print(error)
    output = root / "dev/backend/test/audit/artifacts"
    output.mkdir(exist_ok=True)
    (output / "server-http-2026-10-13.jsonl").write_text("".join(records), encoding="utf-8")
    raise SystemExit(stdout.channel.recv_exit_status())
finally:
    ssh.close()
