#!/usr/bin/env python3
"""Decodes a Merit workflow account (campaign or ledger) from DevNet.

Usage: scripts/merit-state.py <address> [field ...]
Field order and types come from the program manifest; bincode encodes
vectors with a u64 length prefix, so offsets after the first vector are
computed while reading.
"""
import base64, json, struct, sys, urllib.request, pathlib

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def b58(raw):
    n = int.from_bytes(raw, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = ALPHABET[r] + out
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + out

def account(address):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                       "params": [{"address": address, "encoding": "base64"}]}).encode()
    req = urllib.request.Request("https://devnet.rialo.io", body, {"content-type": "application/json"})
    value = json.load(urllib.request.urlopen(req))["result"]["value"]
    if not value:
        return None, 0
    data = value["data"]
    data = data[0] if isinstance(data, list) else data
    return base64.b64decode(data), value.get("kelvin")

# The manifest types every vector as "bytes"; element types from src/lib.rs.
VECTORS = {"outcome": "u64", "e_contributor": "pubkey", "e_x_user": "u64", "e_post": "u64",
           "e_score": "u64", "e_amount": "u64", "e_hash": "pubkey", "e_status": "u64",
           "e_attempts": "u64", "e_checked_ms": "u64", "e_report": "pubkey", "x_token": "u8",
           "day_hours": "u64", "day_paid": "u64"}
# Program v2 fields sit between x_token and the REX bytecode account; v1 accounts have none.
V2 = ["paused", "max_per_day", "approval_threshold", "cooldown_ms", "submit_grace_ms", "round_approved",
      "day_hours", "day_paid", "payee_x_user", "payee_wallet", "payee_since_ms"]

def decode(raw, structure):
    out, at = {}, 0
    def take(kind):
        nonlocal at
        if kind in ("u64", "usize"):
            v = struct.unpack_from("<Q", raw, at)[0]; at += 8; return v
        if kind == "bool":
            v = raw[at] != 0; at += 1; return v
        if kind == "pubkey":
            v = b58(raw[at:at + 32]); at += 32; return v
        raise ValueError(kind)
    for field in structure:
        name, kind = field["name"], field["type"]
        if name in V2 and len(raw) - at <= 32:
            out["_version"] = 1
            continue
        if name in VECTORS or kind == "bytes":
            n = take("u64")
            inner = VECTORS.get(name, "u8")
            if inner in ("u8", "bytes"):
                out[name] = f"<{n} bytes>"; at += n
            else:
                out[name] = [take(inner) for _ in range(n)]
        else:
            out[name] = take(kind.lower())
    return out

def main():
    manifest = json.load(open(pathlib.Path(__file__).resolve().parents[1] / "programs/merit/wit/merit-manifest.json"))
    raw, kelvins = account(sys.argv[1])
    if raw is None:
        print("account does not exist"); return
    state = decode(raw, manifest["workflow_state"]["structure"])
    state["_kelvins"] = kelvins
    fields = sys.argv[2:]
    print(json.dumps({k: v for k, v in state.items() if not fields or k in fields}, indent=1))

main()
