# F.A Vision project guidance

- This is a static GitHub Pages site. Read `README.md` or `CLAUDE.md` only for the relevant feature area.
- Treat `data/*.json` as source data. For product or business listing changes, run `python scripts/generate_listings.py`; never hand-edit `assets/js/products-data.js` or `output/`.
- Copy must say “we sell,” not “we make.” Keep customer names, phone numbers, order details, credentials, and other private data out of public files and prompts to third-party services.
- Follow existing Admin, extension, localization, and error-reporting patterns. Make focused changes and add tests for behavior being introduced or fixed.
- After changes to `admin/*.js`, `data/*.json`, or seasonal ads, run `node scripts/admin_smoke.js`. For extension changes, run `node scripts/addon_mock_test.js`; use the documented targeted selector when appropriate.
- Do not perform live social posting, customer messaging, payments, account changes, or deployment unless the user explicitly asks.
- Do not invoke the repository security-review agent unless the user requests a security review.
- The optional 21st MCP is search-only. Use generic UI queries; never send proprietary code, customer data, credentials, or other sensitive information to it.
