#!/usr/bin/env python3
"""PostToolUse hook: after data/products.json or data/business.json changes, rebuild the
listings (assets/js/products-data.js and output/) with scripts/generate_listings.py.
A failed rebuild is reported back (exit 2) so it gets fixed straight away."""
import json, os, re, subprocess, sys

try:
    event = json.load(sys.stdin)
except Exception:
    sys.exit(0)
inp = event.get("tool_input") or {}
path = str(inp.get("file_path") or "")
if event.get("tool_name") == "Bash":
    path = str(inp.get("command") or "")
    # only commands that write the file (not git add / cat / grep)
    if not re.search(r"sed\s+-i|>\s*\S*data/(products|business)\.json|tee\s|\b(cp|mv)\b[^;&|]*data/(products|business)\.json|write_text|json\.dump", path):
        sys.exit(0)
if not re.search(r"(^|/|\s)data/(products|business)\.json", path):
    sys.exit(0)
root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
r = subprocess.run([sys.executable, "scripts/generate_listings.py"], cwd=root, capture_output=True, text=True, timeout=120)
if r.returncode != 0:
    print("Listings rebuild FAILED after editing " + path + ":\n" + (r.stderr or r.stdout)[-1500:], file=sys.stderr)
    sys.exit(2)
print("Listings rebuilt (assets/js/products-data.js, output/).")
sys.exit(0)
