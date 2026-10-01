#!/usr/bin/env python3
"""Build the key.gregy.cz knock page: encrypt the knock target into src/index.html -> www/.

The knock host, fallback public IP and port sequence are encrypted with AES-256-GCM under a key
derived (PBKDF2-HMAC-SHA256) from each secret, so the page source gives nothing away without a
secret. One "lock" per secret; any of them opens the page. The JS tries each lock in turn.

Settings come from knock.local.env (not committed; see knock.local.env.example) or the command line:
the knock ports are read from the file PORTS_ENV points to (K1/K2/K3), the name to resolve from
KNOCK_HOST and the fallback IP from KNOCK_IP. Secrets come from key-secrets.txt (mode 600, one per
line, '#' comments ignored) unless given with --secret.

    ./knockpage.py                         # settings from knock.local.env, secrets from key-secrets.txt
    ./knockpage.py --secret "tajne slovo"  # one-off secret, no file
    ./knockpage.py --list                  # show which secrets are built in

Then publish with ./deploy.sh (pushes www/ to the gh-pages branch).
"""
import argparse, base64, json, os, re, shutil, sys, unicodedata
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

HERE = Path(__file__).resolve().parent
SRC, OUT = HERE / "src", HERE / "www"
LOCAL_ENV = HERE / "knock.local.env"
SECRETS_FILE = HERE / "key-secrets.txt"
ITERATIONS = 200_000

b64 = lambda b: base64.b64encode(b).decode()


def normalize(s: str) -> str:
    """Must match norm() in src/app.js: strip diacritics, lowercase, collapse spaces/_/- to one '-'."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[\s_-]+", "-", s.lower().strip())


def read_env(path: Path) -> dict:
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"\'')
    return env


def read_ports(ports_env: str) -> list[int]:
    path = (HERE / ports_env).resolve()
    if not path.exists():
        sys.exit(f"ports file {path} is missing (PORTS_ENV in {LOCAL_ENV.name}, or use --ports)")
    env = read_env(path)
    try:
        return [int(env["K1"]), int(env["K2"]), int(env["K3"])]
    except KeyError:
        sys.exit(f"could not read K1/K2/K3 from {path}")


def read_secrets() -> list[str]:
    if not SECRETS_FILE.exists():
        sys.exit(f"no secrets given and {SECRETS_FILE} is missing (see README.md)")
    out = []
    for line in SECRETS_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    if not out:
        sys.exit(f"{SECRETS_FILE} has no secrets")
    return out


def make_lock(secret: str, payload: bytes) -> dict:
    salt, iv = os.urandom(16), os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    key = kdf.derive(normalize(secret).encode())
    ct = AESGCM(key).encrypt(iv, payload, None)
    return {"s": b64(salt), "i": b64(iv), "n": ITERATIONS, "c": b64(ct)}


def main():
    local = read_env(LOCAL_ENV) if LOCAL_ENV.exists() else {}
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--secret", action="append", help="a secret (repeatable); overrides key-secrets.txt")
    ap.add_argument("--host", default=local.get("KNOCK_HOST"), help="name the page resolves over DoH (KNOCK_HOST)")
    ap.add_argument("--ip", default=local.get("KNOCK_IP"), help="fallback public IP if DoH fails (KNOCK_IP)")
    ap.add_argument("--ports", help="comma-separated knock ports; default from the PORTS_ENV file")
    ap.add_argument("--list", action="store_true", help="just list the secrets that would be built in")
    args = ap.parse_args()

    secrets = args.secret or read_secrets()
    if args.list:
        for s in secrets:
            print(f"{s!r}  ->  normalized {normalize(s)!r}")
        return

    if not (args.host and args.ip):
        sys.exit(f"need the knock host and fallback IP: KNOCK_HOST/KNOCK_IP in {LOCAL_ENV.name}, or --host/--ip")
    if args.ports:
        ports = [int(p) for p in args.ports.split(",")]
    elif "PORTS_ENV" in local:
        ports = read_ports(local["PORTS_ENV"])
    else:
        sys.exit(f"need the knock ports: PORTS_ENV in {LOCAL_ENV.name}, or --ports")
    payload = json.dumps({"host": args.host, "ip": args.ip, "ports": ports}, separators=(",", ":")).encode()
    locks = [make_lock(s, payload) for s in secrets]
    locks_json = json.dumps(locks, separators=(",", ":"))

    shutil.rmtree(OUT, ignore_errors=True)   # start clean: www/ is published wholesale
    OUT.mkdir()
    # copy static assets (everything in src except index.html, which is templated)
    for item in SRC.iterdir():
        dst = OUT / item.name
        if item.name == "index.html":
            continue
        if item.is_dir():
            shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(item, dst)
        else:
            shutil.copy2(item, dst)
    html = (SRC / "index.html").read_text()
    if "@LOCKS@" not in html:
        sys.exit("src/index.html has no @LOCKS@ placeholder")
    (OUT / "index.html").write_text(html.replace("@LOCKS@", locks_json))

    print(f"built {OUT} with {len(locks)} lock(s), ports {ports}, host {args.host} ({args.ip})")
    print(f"index.html {OUT.joinpath('index.html').stat().st_size} bytes")


if __name__ == "__main__":
    main()
