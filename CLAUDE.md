# F.A Vision Enterprise site: working notes

Static GitHub Pages site, live at https://favisionenterprize.github.io (push to `main` deploys). README.md has the full guide; read it only when needed.

## Edit rules
- Edit data in `data/*.json`, then run `python3 scripts/generate_listings.py`. That rebuilds `assets/js/products-data.js` and `output/`. Never hand-edit `products-data.js`.
- Promos: `data/business.json` → `promos.ads` + `promos.schedule` (first matching date window wins).
- Stock badge: `custom_order` / `in_stock` per product in `data/products.json`.
- Copy says "we sell", not "we make".
- Social autopilot (admin `#fbauto`): Today tab = one button that chains renew → FB group posts → Instagram (`admin/igauto.js` + `extension/instagram.js`, log `data/instagram-autopilot.json`) → emails the posting report (Code.gs `posting_report`, nightly `sendPostingReport` at 9 pm, to nanaotengdonkor1@gmail.com). Add-on version marker `favautoExt` = 4 means Instagram support.
- Facebook autopilot (admin `#fbauto`, `admin/fbauto.js` + `extension/autopilot.js`): renewals and the daily group rotation, logged in `data/facebook-autopilot.json`. The add-on (Alexander uses Microsoft Edge) downloads `autopilot.js`, `facebook.js`, `instagram.js` from the live site via `extension/live.json` and runs them as user scripts, so pushing those files updates it; only `background.js`, `admin.js` or `manifest.json` changes need a manual reload in edge://extensions. Jobs pass admin → `extension/admin.js` (postMessage) → background (per-tab storage), never via the URL hash: Facebook redirects www → web.facebook.com in Ghana and drops it. Renewing works on marketplace/you/selling (More options → Renew listing), not on item pages.

- Daily run order (Today tab): renew → `declines` (notifications + each recent group's `my_declined_content`; leaves declining groups, moves them to `removed[]`, never re-imported/re-joined) → `sync` (import, activates `pending` joins) → `grow` (Facebook group search, joins up to `grow_daily`=20 groups, biggest first: ≥ `grow_min_global`=100K anywhere (1M+ always), or Ghana/Accra-named groups ≥ `grow_min_members`=10K; logged in `joins[]`. Checked live Oct 2026: Ghana groups are 4K–76K, the biggest furniture groups ~380K) → alert email (`session_alert`, plus a once-a-day 🎉 when 20 joined) → group posts → Instagram → report. Day markers in `checks{}`.
- "Post now" tab (`renderNow`/`planNow`/`startPostNow` in fbauto.js): runs any time, separate from the daily plan. Ticked products (kept in localStorage `fa-post-now`) are paired with groups: one product per group per session, never a product into a group it's already been in, groups posted in within `group_rest_hours` (6) rest, max `now_limit` (20). Posts carry `now:true` (FB and IG logs) so they don't use up the daily plan's quota. Instagram gets up to N of the ticked products (`igauto.job({products, limit})`); Facebook Page / X / WhatsApp / TikTok are share buttons.
- Muse AI (`/muse/`): installable phone app (PWA) for Android + iPhone. Network-first `sw.js` + `version.json` check makes it self-update; bump `version.json` when shipping Muse changes. AI goes through Code.gs `muse` action (Script property `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`); without a key, Create falls back to templates.

## Business facts
- Phones: 020 747 3267 · 057 264 6176 · 054 614 8923 (WhatsApp 057 264 6176)
- Locations: Odorkor (showroom), Omanjor (printing press), Kasoa
- Student desk FAV-014: GH₵650/set, GH₵640 each from 50. In stock.

## Partner products
Products with a `seller` block (name, formerly, phones, whatsapp, address) are sold by another business Alexander runs. The site shows "Sold by …", sends WhatsApp/Call to the seller, hides online Buy; listings and strategy ads use the seller's contacts (make_ads.py, generate_listings.py).
- ANAC Essentials (formerly ANAC Ventures): flour FAV-026
- AGOODMANN VENTURES: water closet FAV-024, tiles FAV-025
- MANYE OYE REHOBOTH: rice and canola oil (ads not yet supplied)

## Socials (accounts)
| Platform | Account | How to post |
|---|---|---|
| Facebook Page | F.A Vision Enterprise (id 110032960671410) | Chrome; Windsor can read but can't post. Turn **Boost off**. |
| Instagram | @favisionent | Chrome; switch off "share to Alexander Awuku Facebook" |
| X | @FaVisionEnt | Chrome; ≤280 chars |
| TikTok | FA Vision Enterprise | Chrome → TikTok Studio → Photos tab |

Ad images live at `assets/images/ads/*.jpg` (1080×1350); upload them from this repo path.
