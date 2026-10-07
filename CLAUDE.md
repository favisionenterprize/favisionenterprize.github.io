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
- "Post to all groups" button (per product, Post now tab): import joined groups first, then post into every active group the product hasn't been in this round (`rounds[pid]` = round start), 2–4 s apart; when all are done the next press starts a new round. Button shows done/total for the round. Then step `tt1:<id>` posts that product on TikTok with the full description (`socauto.caption(..., full)`: product description, highlights, size/material/colours, how to order, hashtags).
- X and TikTok autopilot (`admin/socauto.js` + `extension/social.js`, log `data/social-autopilot.json`): same photo pool as Instagram; daily plan `daily_posts` per network (Today tab steps `x`, `tiktok`) and Post now (`xnow`, `ttnow`). Needs the add-on in live mode (social.js only comes via `live.json`). TikTok checked live Oct 2026: `/tiktokstudio/upload?tab=photo`, image file input, Draft.js description (execCommand insertText), "Add a catchy title" input, button "Post"; never discard the user's older unsaved draft. X uses data-testid `tweetTextarea_0` / `fileInput` / `tweetButton` (x.com didn't load in the test Chrome, so not checked live).
- Captions (`admin/captions.js`, `window.FAV_CAPTIONS.write(p, {net})`): every posting feature (FB groups, Post now, Post to all groups, Instagram, X, TikTok, YouTube, videos, share buttons) builds a fresh random description (hook, body, price, place, payment, hashtags) and always ends with a call to action, then the engagement ask (`FAV_CAPTIONS.comment(net)`: "where are you seeing this from? … like and follow the page"; X keeps ≤280 with the link). Facebook group posts also get it as a first comment (`firstComment` in extension/autopilot.js: finds the new post by its first line, types in its comment box, Enter; skipped for posts pending admin approval; best effort, never fails the post; not yet checked live). Approved Seek texts (`copy_variants`) rotate in as the body.
- Videos & YouTube (Social autopilot tab, `admin/vidauto.js` + `extension/youtube.js`, library `data/videos.json`): every video waits here until posted to the website (`/videos/` page shows `website.status === "posted"`), YouTube (add-on upload; needs add-on 5.1+, one manual reload for YouTube permission; not yet checked live) or TikTok (copy description + download + open TikTok Studio, then "Mark posted"). "Add videos" uploads from the computer/phone (≤20 MB each, via `FAV_ADMIN.commitFiles`) into `assets/videos/uploads/`; "Old videos I posted on TikTok" are marked as already on TikTok. `scripts/make_shorts.py` makes 12 s Shorts from the ads and skips ids in `removed[]`.
- Seek (admin dash button "🔎 Seek", `admin/seek.js`, log `data/seek.json`): backend `seek` searches Openverse (CC0/public domain, no key) + Pexels (`PEXELS_API_KEY`, optional) and writes 3 descriptions + highlights with web search (Gemini grounding or Claude web_search), held to the product's facts; nothing changes until Alexander ticks and presses "Approve & publish". `seek_fetch` downloads approved photos; they go first in `images` (max 10; ticked old photos come off but files stay), with `image_credits` shown under the product gallery on the site. Badge reminds after 14 days.
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
