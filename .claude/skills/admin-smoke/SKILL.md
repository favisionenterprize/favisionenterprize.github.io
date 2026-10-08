---
name: admin-smoke
description: Smoke-test the admin before pushing - opens every Social autopilot tab and the Leads screen with the real data/*.json files, today and on each seasonal ad's first and last day, and fails on page errors or blank tabs. Use after any change to admin/*.js, data/*.json or a seasonal ad, and before pushing.
---

# Admin smoke test

Run from the repo root:

```bash
node scripts/admin_smoke.js
```

- Needs Playwright (`npm i -g playwright`, `npx playwright install chromium`). In the Claude cloud
  sandbox use the preinstalled browser:
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome NODE_PATH=$(npm root -g) node scripts/admin_smoke.js`
- Nothing is posted, saved or fetched: data files are read-only, the backend is mocked.
- Exit 0 = every tab drew. Exit 1 = a tab threw, looked blank, or showed an error toast; the
  failing date and message are printed. Fix the cause, run again, then push.
- It also runs on GitHub (workflow `admin-smoke.yml`) after pushes to `admin/` or `data/`, so a
  failure there emails the repo owner.
- When adding a new admin screen or autopilot tab, extend `scripts/admin_smoke.js` so it is covered.
