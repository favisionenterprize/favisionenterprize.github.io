#!/usr/bin/env python3
"""PreToolUse hook: never hand-edit generated files (CLAUDE.md edit rule).

assets/js/products-data.js and output/ are rebuilt by scripts/generate_listings.py from
data/products.json and data/business.json. Blocks Edit/Write/MultiEdit on them, and Bash
commands that would write to them (sed -i, >, tee, cp/mv onto them). Exit 2 = blocked.
"""
import json, re, sys

GENERATED = re.compile(r"(^|/)(assets/js/products-data\.js|output/)")

try:
    event = json.load(sys.stdin)
except Exception:
    sys.exit(0)
tool = event.get("tool_name", "")
inp = event.get("tool_input") or {}

def block(what):
    print(f"Blocked: {what} is generated. Edit data/products.json or data/business.json instead; "
          "scripts/generate_listings.py rebuilds it (the rebuild hook runs it for you).", file=sys.stderr)
    sys.exit(2)

if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
    path = str(inp.get("file_path") or inp.get("notebook_path") or "")
    if GENERATED.search(path):
        block(path)
elif tool == "Bash":
    cmd = str(inp.get("command") or "")
    if "generate_listings.py" in cmd:
        sys.exit(0)  # the generator itself is allowed to write them
    for target in re.findall(r"(?:assets/js/products-data\.js|output/\S*)", cmd):
        writes = re.search(r"(sed\s+-i|perl\s+-[a-z]*i|>>?\s*\S*" + re.escape(target) + r"|tee\s+(-a\s+)?\S*" + re.escape(target) +
                           r"|\b(cp|mv|install)\b[^;&|]*" + re.escape(target) + r"\s*($|[;&|]))", cmd)
        if writes:
            block(target)
sys.exit(0)
