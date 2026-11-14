---
name: fa-vision-workflow
description: Use when changing the F.A Vision website, Admin, automation, source data, or release checks.
---

# F.A Vision workflow

1. Check the worktree and preserve changes that are not part of the current request.
2. Read the relevant code and nearby tests before editing. Keep the change scoped to the requested behavior.
3. For product or business listing changes, edit the appropriate `data/*.json` source and run `python scripts/generate_listings.py`. Do not hand-edit generated listings.
4. For Admin or seasonal-ad changes, run `node scripts/admin_smoke.js`. For extension changes, run `node scripts/addon_mock_test.js` or the documented targeted selector.
5. Inspect the final diff and test output. Report any unrelated failures clearly.
6. Never publish, message customers, or alter live accounts as part of a test. Commit or push only when explicitly requested.
