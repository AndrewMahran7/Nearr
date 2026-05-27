#!/usr/bin/env python3
"""Smoke-test the Nearr Social Evidence Server.

Usage:
  python scripts/test_evidence_server.py \
    --base-url http://localhost:8088 \
    --key "$NEARR_EVIDENCE_SERVER_KEY"

Tests:
  - GET  /health
  - POST /extract/profile-bio   (multiple handles)
  - POST /extract/video-transcript (multiple URLs)
  - POST /extract/social-evidence   (multiple URLs)

Prints a one-line summary per call and a final pass/fail count.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

import httpx

TEST_HANDLES = [
    "oldfishermansgrotto",
    "dametrafresh",
    "wavestreetcafe",
    "thecrestaurant",
    "lallagrill",
]

TEST_URLS = [
    "https://www.instagram.com/p/DLfvZunSKRp/",
    "https://www.instagram.com/p/DWT23XLAf6B/",
    "https://www.instagram.com/p/DVKjs6nEXPn/",
]


def _short(d: Any, n: int = 240) -> str:
    s = json.dumps(d, default=str)
    return s if len(s) <= n else s[:n] + "..."


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("EVIDENCE_BASE_URL", "http://localhost:8088"))
    parser.add_argument("--key", default=os.environ.get("NEARR_EVIDENCE_SERVER_KEY", ""))
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args()

    if not args.key:
        print("ERROR: --key (or NEARR_EVIDENCE_SERVER_KEY env) is required", file=sys.stderr)
        return 2

    headers = {"X-NEARR-EVIDENCE-KEY": args.key, "content-type": "application/json"}
    base = args.base_url.rstrip("/")
    passed = 0
    failed = 0

    with httpx.Client(timeout=args.timeout) as client:
        # --- /health ---
        print("== GET /health ==")
        t0 = time.time()
        r = client.get(f"{base}/health")
        print(f"  {r.status_code}  ({int((time.time()-t0)*1000)}ms)  {_short(r.json())}")
        (passed if r.status_code == 200 else failed)  # noqa
        if r.status_code == 200:
            passed += 1
        else:
            failed += 1

        # --- /extract/profile-bio ---
        print("\n== POST /extract/profile-bio ==")
        for h in TEST_HANDLES:
            t0 = time.time()
            try:
                r = client.post(f"{base}/extract/profile-bio", headers=headers,
                                json={"platform": "instagram", "handle": h})
                data = r.json()
                ok = r.status_code == 200 and (data.get("success") or data.get("errors"))
                cls = (data.get("profile") or {}).get("classification") if data.get("profile") else None
                errs = [e.get("type") for e in data.get("errors", [])]
                print(f"  [{'OK' if ok else 'FAIL'}] @{h}  http={r.status_code}  classification={cls}  errors={errs}  ({int((time.time()-t0)*1000)}ms)")
                passed += 1 if ok else 0
                failed += 0 if ok else 1
            except Exception as e:  # noqa: BLE001
                print(f"  [EXC] @{h}  {e}")
                failed += 1

        # --- /extract/video-transcript ---
        print("\n== POST /extract/video-transcript ==")
        for u in TEST_URLS:
            t0 = time.time()
            try:
                r = client.post(f"{base}/extract/video-transcript", headers=headers,
                                json={"url": u, "platform": "instagram"})
                data = r.json()
                ok = r.status_code == 200
                tr = data.get("transcript") or {}
                meta = data.get("metadata") or {}
                errs = [e.get("type") for e in data.get("errors", [])]
                print(f"  [{'OK' if ok else 'FAIL'}] {u}  http={r.status_code}  source={tr.get('source')}  "
                      f"chars={len(tr.get('text') or '')}  author=@{meta.get('authorHandle')}  errors={errs}  "
                      f"({int((time.time()-t0)*1000)}ms)")
                passed += 1 if ok else 0
                failed += 0 if ok else 1
            except Exception as e:  # noqa: BLE001
                print(f"  [EXC] {u}  {e}")
                failed += 1

        # --- /extract/social-evidence ---
        print("\n== POST /extract/social-evidence ==")
        for u in TEST_URLS:
            t0 = time.time()
            try:
                r = client.post(f"{base}/extract/social-evidence", headers=headers,
                                json={"url": u, "includeTranscript": True, "includeProfiles": True})
                data = r.json()
                ok = r.status_code == 200
                q = data.get("evidenceQuality")
                n_prof = len(data.get("profiles") or [])
                errs = [e.get("type") for e in data.get("errors", [])]
                print(f"  [{'OK' if ok else 'FAIL'}] {u}  http={r.status_code}  quality={q}  profiles={n_prof}  errors={errs}  ({int((time.time()-t0)*1000)}ms)")
                passed += 1 if ok else 0
                failed += 0 if ok else 1
            except Exception as e:  # noqa: BLE001
                print(f"  [EXC] {u}  {e}")
                failed += 1

    print(f"\n--- SUMMARY: passed={passed}  failed={failed} ---")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
