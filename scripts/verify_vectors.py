#!/usr/bin/env python3
"""Independent check of test-vectors/bundle-hash.json (Python hashlib, no SDK code).

Usage: verify_vectors.py [--update]
--update rewrites the expected `hash` and `preimageHex` values.
"""
import base64
import hashlib
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test-vectors")
PREIMAGE_MAX = 1024


def content(f):
    if "contentBase64" in f:
        return base64.b64decode(f["contentBase64"])
    r = f["contentRepeat"]
    return r["text"].encode("utf-8") * r["count"]


def preimage(files):
    out = bytearray()
    for path, data in sorted(files, key=lambda x: x[0]):
        out += path + b"\x00" + str(len(data)).encode("ascii") + b"\x00" + data
    return bytes(out)


def dir_files(root):
    files = []
    broot = os.fsencode(root)
    for dirpath, dirnames, filenames in os.walk(broot):
        for name in filenames:
            abs_path = os.path.join(dirpath, name)
            rel = os.path.relpath(abs_path, broot).replace(os.sep.encode(), b"/")
            with open(abs_path, "rb") as fh:
                files.append((rel, fh.read()))
    return files


def main():
    update = "--update" in sys.argv
    path = os.path.join(ROOT, "bundle-hash.json")
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    failures = 0
    for v in doc["vectors"]:
        files = [(f["path"].encode("utf-8"), content(f)) for f in v["files"]]
        pre = preimage(files)
        got = "sha256:" + hashlib.sha256(pre).hexdigest()
        if update:
            v["hash"] = got
            if len(pre) <= PREIMAGE_MAX:
                v["preimageHex"] = pre.hex()
            else:
                v.pop("preimageHex", None)
        else:
            if v["hash"] != got:
                print(f"FAIL {v['name']}: expected {v['hash']}, got {got}")
                failures += 1
            if "preimageHex" in v and v["preimageHex"] != pre.hex():
                print(f"FAIL {v['name']}: preimage differs")
                failures += 1
    for d in doc["directories"]:
        got = "sha256:" + hashlib.sha256(preimage(dir_files(os.path.join(ROOT, d["path"])))).hexdigest()
        if update:
            d["hash"] = got
        elif d["hash"] != got:
            print(f"FAIL directory {d['path']}: expected {d['hash']}, got {got}")
            failures += 1
    if update:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"updated {path}")
        return 0
    total = len(doc["vectors"]) + len(doc["directories"])
    print(f"{total - failures}/{total} bundle hash vectors match (Python hashlib)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
