# FA Vision Enterprise Furniture Store

Online presence for **F.A Vision Enterprise**: bulk & wholesale furniture, upholstery, a bookstore and a printing press in **Odorkor, Omanjor and Kasoa** (Accra / Central Region, Ghana).

**Live website:** https://favisionenterprize.github.io/
**Admin (post products):** https://favisionenterprize.github.io/admin/

## About

FA Vision Enterprise sells quality furniture for homes, offices and schools, in single pieces or in bulk at wholesale prices. It also does upholstery and re-upholstery, runs a bookstore (books and stationery) and a printing press. This repository holds the store's website, its admin page and the Facebook listing kit.

The catalogue holds the real products from the Facebook Marketplace listings (photos cleaned up and framed to 4:3). Products marked **Price not confirmed** in the admin had different prices on different Facebook listings: set the right price in the admin, then use **Price sync** to bring Facebook in line.

## Posting products (admin)

Open `/admin/` on your phone or computer. It works like posting an ad on Jiji:

1. **Category & photos.** Pick a category and type, then add photos. The first photo is the main photo; drag or use the arrows to reorder. Every photo is auto-enhanced and framed to the website's 4:3 shape. Tap **✎ Edit** on a photo to open the photo studio (below).
2. **Details & price.** Title, condition, material, size, colours, description, key features, price (negotiable or not, or "price on request"), made to order, in stock.
3. **Review & post.** See the card exactly as customers will, then post.

After posting you get one-tap buttons to send the product on WhatsApp, or copy a Facebook Marketplace listing, a group post or a WhatsApp status. **🎨 Create promo image** makes a branded picture (square post or status/story, dark or cream) to share or download. **My products** lets you edit, share, mark sold or delete anything.

### Photo studio (✎ Edit)

Everything runs in the browser, and photos never leave your device until you post.

- **Frame:** *Fill frame* (drag to position, zoom) or *Show whole piece* on a backdrop, straighten (±15°), rotate 90°.
- **Light & colour:** *Auto-enhance* (on by default) plus brightness, contrast, warmth and colour sliders. Hold **Compare** to see the original.
- **Background:** *Remove background* cuts the furniture out with on-device AI and puts it in a studio (white, cream, soft grey or showroom dark) with a soft floor shadow. The first use downloads about 55 MB, so use Wi-Fi; it's cached after that. It works best when the furniture is the main thing in the photo.
- **Use this look on all photos** copies the light, framing style and background to the product's other photos, so a product's photos match.

Background removal uses [@imgly/background-removal](https://github.com/imgly/background-removal-js) (AGPL-3.0), loaded from jsDelivr.

**How it works:** there's no server to pay for. The admin saves products and photos straight into this GitHub repository, and GitHub Pages republishes the site about a minute later.

### One-time sign-in setup

The admin needs a GitHub token that can only edit this one repository:

1. Open https://github.com/settings/personal-access-tokens/new (Settings → Developer settings → Fine-grained tokens → Generate new token).
2. **Token name:** FA Vision Admin. **Expiration:** 1 year.
3. **Repository access:** Only select repositories → `favisionenterprize.github.io`.
4. **Permissions → Repository permissions → Contents:** Read and write.
5. Generate it, copy it, and paste it into the admin's sign-in box.

The token stays in that browser only. Anyone who has it can change the website, so don't share it. If a phone is lost, delete the token on GitHub and create a new one.

## Payments (MoMo, Visa/Mastercard, deposit, pay on delivery, walk in)

Every priced, in-stock product has a **Buy now** button. At checkout the customer picks how to pay:

| Option | What happens |
|---|---|
| **Pay in full now** | Mobile Money (MTN MoMo, Telecel Cash, AT Money) or Visa / Mastercard |
| **Pay 50% deposit now** | Deposit online, balance on delivery or pickup (change `deposit_percent` to use another percentage) |
| **Pay on delivery** | Nothing online; cash or MoMo when the piece arrives |
| **Walk in & pay at showroom** | Reserves the piece; the customer pays at Odorkor |

Pay on delivery and walk in work straight away. To turn on the **pay now** options, fill in `payments` in `data/business.json` and run `python3 scripts/generate_listings.py`:

```json
"payments": {
  "paystack_public_key": "pk_live_…",
  "momo_number": "+233…",
  "momo_name": "F.A Vision Enterprise",
  "momo_network": "MTN",
  "ghanapay_number": "",
  "ghqr_merchant_id": "",
  "deposit_percent": 50
}
```

- **Paystack (MoMo + Visa/Mastercard).** Sign up free at <https://paystack.com> (Ghana). There's no setup or monthly fee, only a small percentage per successful payment, and money settles to your bank or MoMo wallet. Once your business is activated, copy the **Public key** from *Settings → API Keys & Webhooks* into `paystack_public_key`. Use the `pk_test_…` key first to try it with test cards and test MoMo numbers.
- **Manual MoMo (no Paystack yet).** Put your MoMo merchant or wallet number in `momo_number`. Customers get your number, the amount and an order reference, pay with *170#, and confirm on WhatsApp. Cards need Paystack.
- **GhanaPay (GhIPSS bank wallet, `*707#` or the GhanaPay app).** Shown as its own "Pay with" option whenever MoMo is set up. GhanaPay can send to other networks, so by default customers send to your `momo_number`. Once you have your own GhanaPay wallet, put its number in `ghanapay_number`. If your bank registers you as a GhQR merchant, put the merchant ID in `ghqr_merchant_id`, and customers will be told to use *Pay merchant (GhQR)* instead. Customers confirm on WhatsApp with the order reference. GhanaPay payments don't go through Paystack, so check your wallet before releasing goods.
- **Never put the Paystack secret key (`sk_…`) in the website.** It goes only in the backend (below).

Every order, paid or not, is saved to the **Orders** tab of the backend Sheet, emailed to you, and listed in the admin under **Orders & payments**, where you can move it along (Confirmed → Delivered → Balance paid). Paystack also notifies the backend directly and an hourly sync catches anything missed, so a payment is recorded even if the customer closes the page. Setup steps: [backend/README.md](backend/README.md#orders--payments). Add `PAYSTACK_SECRET_KEY` to the Apps Script's *Script properties* and the backend checks each online payment with Paystack and re-prices the order from the catalogue, so a tampered or failed payment shows as **UNVERIFIED** or **UNDERPAID**. Always check the Orders tab or your Paystack dashboard before releasing furniture.

## AI Studio (/studio/)

**https://favisionenterprize.github.io/studio/** has a free **Room Designer** and sells AI-assisted services to furniture customers and the neighbourhood.

**Room Designer (free).** Customers pick a room and its size, paint or wallpaper, and tap pieces to add them in the colours each product comes in. A drawn room view and a to-scale floor plan (drag to move, tap to turn) show how it looks and fits. Catalogue pieces and priced wallpaper go to checkout together, so customers only pay for what they order; pieces not on the site yet show as "Ask for price" and are sent as a quote request. Designs can be shared as a link. Sizes are typical ones per product type (`assets/js/room-designer.js` → `TYPES`); add `"footprint_cm": {"w": 200, "d": 90, "h": 85}` to a product to use its real size. **Wallpaper:** post it in the admin under *Walls & Decor → Wallpaper* with the price **per roll** and a close-up photo of the pattern; it appears on the designer's walls and the rolls are worked out from the room size (a roll is taken as 5.3 m² unless the product has `roll_m2`).

**Strategy ad.** `python3 scripts/make_studio_ad.py` (with the site served on port 8765) rebuilds `assets/images/ads/ai-studio.jpg` (feed) and `ai-studio-story.jpg` (Status/Stories) from the live designer. The feed ad leads the Deals row and is the preview picture when the /studio/ link is shared.

The paid services: Customers pick a service, fill in a short brief, then pay through the same checkout as furniture (MoMo, card, 50% deposit, pay when it's ready, or pay at a showroom). Guides are pay-first. Orders go to the Orders tab and the brief to the Enquiries tab under the same reference, with an SMS alert. Prices live in `data/services.json`; the fulfilment steps are in [docs/ai-studio-playbook.md](docs/ai-studio-playbook.md).

## Strategy ads and the promo calendar

Every product has a designed strategy ad (1080 × 1350, the size Facebook, Instagram and WhatsApp Status show uncropped) in `assets/images/ads/`. They appear on the website under **Deals** with **View** and **Share** buttons, and can be posted as they are.

- Wording lives in `data/business.json` → `promos.ads` (headline, accent word, facts row, price seal, tag). Rebuild after editing: `python3 scripts/make_ads.py && python3 scripts/generate_listings.py`.
- `promos.schedule` decides the announcement bar, the desk promo sticker and which ads lead the Deals row. The first entry whose dates include today wins. `YYYY-MM-DD` dates run once (the student desk consignment shows "just arrived" from 1 October until 15 November 2026); `MM-DD` dates repeat every year (festive, new-year office, Valentine's, Easter, mid-year office, back to school, home refresh). Nothing needs switching off by hand.

## "What's in the Box?" ads

`python3 scripts/make_box_ads.py` builds a black, oraimo-style "What's in the Box?" ad for every product (`assets/images/ads/box/box-<id>.jpg` feed and `-story.jpg`), from `in_the_box` in `data/products.json` (item, quantity, icon; plus optional `box_title`, `box_note`, `box_size`). Check and correct each list in the admin under **📦 What's in the Box ads** (`/admin/#boxads`) and tick **✓ Confirmed**; the ads rebuild automatically. The same ads show on product pages, in the product view and in the homepage section **How our products arrive**, and rotate into the social autopilot.

## Price sync (website ↔ Facebook Marketplace)

`/admin/#pricesync` lists every Facebook listing linked to a product (`facebook_listings` in `data/products.json`) next to the website price. Facebook has no API for personal Marketplace listings, so the website can't change Facebook prices itself. The screen is built for speed instead: changing a price or tapping **✓ Done** updates the screen instantly and saves to GitHub in the background (quick taps are bundled into one save). Red rows need their price changed on Facebook: **Copy** → **Edit ↗** → paste → Update → **✓ Done**, or ask Claude to "sync my Facebook prices".

Ad copy and promo bars in `business.json` use `{price}` / `{price:FAV-001}` placeholders, and `.github/workflows/rebuild-ads.yml` rebuilds the ads and listing texts after every change to `data/`.

## What's inside

| Path | Purpose |
|---|---|
| `index.html` | Storefront: hero, collection with search/filters/sort, product pages (`#product/FAV-001` links), custom-order form, showroom and contacts |
| `assets/css/site.css`, `assets/js/site.js` | Storefront styling and behaviour |
| `assets/js/checkout.js` | Buy now checkout: MoMo / card via Paystack, manual MoMo, deposit, pay on delivery, walk in |
| `admin/` | Admin page for posting, editing and sharing products (`admin.js`), orders & payments (`orders.js`), photo studio (`photo-studio.js`, `photo-editor.js`) and promo images (`promo.js`) |
| `assets/js/catalog-config.js` | Categories, product types, colours and icons shared by the site and admin |
| `assets/js/products-data.js` | Product and business data the site reads. **Generated, don't edit by hand.** |
| `assets/images/products/` | Product photos uploaded from the admin |
| `assets/images/og-cover.jpg` | Preview image shown when the site link is shared on WhatsApp or Facebook |
| `data/products.json` | The product list. The admin edits this for you. |
| `data/business.json` | Name, tagline, address, phone/WhatsApp numbers, service areas, hashtags |
| `data/groups.csv` | Facebook groups you post in |
| `scripts/make_ads.py` | Builds the strategy ads in `assets/images/ads/` from `promos.ads` |
| `scripts/make_box_ads.py`, `admin/boxads.js` | "What's in the Box?" ads from `in_the_box`, and the admin screen to check them |
| `admin/pricesync.js` | Price sync screen: website vs Facebook Marketplace prices |
| `.github/workflows/rebuild-ads.yml` | Rebuilds ads and listing texts on GitHub whenever data changes |
| `scripts/generate_listings.py` | Rebuilds `assets/js/products-data.js` and the bulk listing files in `output/` |
| `output/` | Bulk Marketplace/group/WhatsApp texts, posting tracker and Meta catalog feed |
| `docs/facebook-posting-playbook.md` | Weekly posting routine and rules for staying within Facebook's limits |
| `docs/business-profile.md` | Business profile, product lines and operating details |
| `studio/`, `assets/js/studio.js`, `assets/js/room-designer.js`, `assets/css/studio.css` | AI Studio: free Room Designer (furniture + wallpaper, room view + floor plan) and paid AI services (bulk layouts, guides, event programmes, business kits, letters) with the same checkout |
| `scripts/make_studio_ad.py` | Builds the AI Studio strategy ads |
| `data/services.json` | AI Studio services, options and prices (read by the site and the backend) |
| `docs/ai-studio-playbook.md` | How to fulfil each AI Studio order, with prompts |

## Brand

The site uses the F.A Vision logo from Canva ("FA VISION ENT LOGO") and its colours:

| Colour | Hex | From the logo |
|---|---|---|
| Blue | `#0d55af` | "Vision" (main buttons, links) |
| Red | `#f42c2c` | "FA", "ENTERPRISE" (labels, directions buttons) |
| Pink | `#e6506e` | Ring, top left |
| Purple | `#b03ea6` | Ring, right |

The colours are CSS variables at the top of `assets/css/site.css` (`--brand-*`). Logo files: `assets/images/logo.png` (header), `logo-512.png` (Google), `favicon.png`, `apple-touch-icon.png`. The share picture for WhatsApp/Facebook is `assets/images/og-cover.jpg`.

## Google search (SEO) and getting found

The website tells Google who we are in three ways:

- **Page title and description** mention wholesale furniture, upholstery, bookstore, printing press, Odorkor, Omanjor, Kasoa and all three phone numbers.
- **Structured data** (the `application/ld+json` blocks in `index.html`) lists the business, its three locations as furniture stores, opening hours, phone numbers, services and Facebook pages, plus the FAQ.
- **`robots.txt` and `sitemap.xml`** point search engines at `https://favisionenterprize.github.io/`.

To start getting traffic from Google (only the business owner can do these):

1. **Google Search Console:** go to https://search.google.com/search-console, add the property `https://favisionenterprize.github.io/` (URL prefix), choose **HTML tag**, and paste the `<meta name="google-site-verification" ...>` tag into the `<head>` of `index.html` (or send it to Claude to add). Then open **Sitemaps** and submit `sitemap.xml`, and use **URL inspection → Request indexing** on the home page.
2. **Google Business Profile** (this is what makes you show on Google Maps and "near me" searches): all three branches are already on Google Maps ("Fa Vision Enterprise Odorkor Branch", "Fa Vision Enterprise - Omanjor Branch", "FA Vision Enterprise Kasoa Branch"). Open each one in Google Maps and tap **Own this business?** / **Claim this business** (or manage it at https://business.google.com if it's already yours). Verify it, then under **Edit profile → Contact** set **Website** to `https://favisionenterprize.github.io/`. Add categories *Furniture store*, *Furniture wholesaler*, *Upholstery shop*, *Book store*, *Print shop*, all three phone numbers, hours, and photos.
3. **Exact map pins:** done. Each location's Google Maps link and coordinates are in `data/business.json` (`locations[].maps_url`, `lat`, `lng`) and in the website's structured data. If a pin moves, paste the new **Share → Copy link** there and run `python3 scripts/generate_listings.py`.
4. **Point everything at the website:** put `https://favisionenterprize.github.io/` in the website field of both Facebook pages, WhatsApp Business profile, Instagram bio and any directory listings (Jiji, Tonaton, Ghana Yellow Pages).

## Changing contact details

Phone and WhatsApp numbers, the address, the three `locations`, `services`, `seo_keywords` and hashtags live in `data/business.json`. After editing it, run `python3 scripts/generate_listings.py` and commit, and the site and listings pick up the change.

## Bulk listing files

The admin's share buttons cover day-to-day posting. To rebuild the bulk files in `output/` (all products at once, the posting tracker and the Meta catalog feed), run:

```bash
python3 scripts/generate_listings.py
```

## Preview locally

Open `index.html` in any browser. There's no build step and nothing to install. The admin page needs an internet connection because it saves to GitHub.

## Invoices

- **Customers** request an invoice on the website (**Invoice** in the menu, the **Request a proforma invoice** button on the student-desk promo, or **Request an invoice for this order** after checkout). The request goes to the backend Sheet's **Invoices** tab and to WhatsApp, so nothing is lost even before the backend is connected.
- **You** open `/admin/#invoices` (no GitHub sign-in needed). Each request becomes a draft with the customer's details and a best guess of the lines (e.g. "70 sets FAV-014" → 70 × GH₵650). Adjust quantities, discounts, transport and fixing, deposit or amount already paid, and taxes if you register for VAT, then tap **Generate invoice**.
- One click: the invoice gets the next number (**PINV100684** for a proforma, **INV…** for an invoice, **RCT…** for a receipt, continuing from the paper series PINV100683), opens ready to **Print / Save as PDF**, and, with the backend connected, is saved as a PDF in your Google Drive folder **FA Vision Invoices**, emailed to the customer and linked in the Sheet. A **Send on WhatsApp** button sends the link.
- The layout (`assets/js/invoice.js`) follows standard invoice practice: seller and buyer names, addresses, phones, email and TIN; invoice number, date, due date, PO and order reference; currency; itemised rate × quantity − discount; subtotal, discount, taxes, total; amount in words; deposit, paid and balance; how to pay; terms; signature and date.
- Settings are in `data/business.json` → `invoice`: your **TIN**, `vat_registered`, `taxes` (e.g. `[{"name": "VAT", "rate": 15}]`), `payment_terms_days`, `bank_details` and `terms`. MoMo details come from `payments`.

## Student desk promo

The yellow-and-grey desk set (FAV-014) is promoted with a bar at the very top of every page and a flyer section under the hero, with tabs for **school proprietors** (bulk price, proforma invoice), **parents** (buy one set) and **everyone** (churches, tutorial centres, donors). The flyer image `assets/images/promo-student-desks.jpg` (1080 × 1350) is sized for WhatsApp Status, Instagram and Facebook; **Share this flyer** sends it from a phone.

## Publish the website free with GitHub Pages

GitHub Pages is already switched on for this repository: every change merged into `main` is live at https://favisionenterprize.github.io/ about a minute later. To check or change it:

1. On GitHub, go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/ (root)`, then **Save**.
4. After a minute the site is live at
   `https://favisionenterprize.github.io/`

## How it fits together

- [x] Landing page with business overview and location
- [x] Product catalogue with prices (GHS), filterable by category
- [x] Contact and enquiry form (sends via WhatsApp)
- [x] Phone / WhatsApp number in the contact section
- [x] Facebook Marketplace and group listing kit
- [x] Admin page for posting products with photos
- [x] Real products and photos (from Facebook Marketplace)
- [ ] Confirm prices marked "Price not confirmed" in the admin
- [x] Publish the website on GitHub Pages
- [x] Simple sales and expense tracking (Google Sheet backend, see [`backend/`](backend/))

## Backend: enquiries, sales, expenses and batch emails

[`backend/`](backend/) is a Google Sheet with Apps Script (free, no server). It:

- saves every **Custom orders** request from the website (as well as opening WhatsApp) and emails you an alert
- keeps your **client list**, **sales** and **expenses**, with a profit summary by month
- sends **batch email campaigns** within Gmail's daily limit, with unsubscribe links

Setup takes about 10 minutes: see [`backend/README.md`](backend/README.md). The last step is pasting the Sheet's web app URL into `enquiry_endpoint` in `data/business.json`. Until then the form works exactly as before, WhatsApp only.

The first campaign, student desks for school proprietors, is in [`marketing/campaigns/student-desks-proprietors.md`](marketing/campaigns/student-desks-proprietors.md).

## Contact

WhatsApp 057 264 6176 · Call 020 747 3267 / 057 264 6176 / 054 614 8923 · [Facebook](https://www.facebook.com/FaVisionEnterprise) · https://favisionenterprize.github.io/

## Locations

- **Odorkor** (main showroom): Tarazzo Road, opposite Pacific, Odorkor, Accra
- **Omanjor**: Omanjor, Accra
- **Kasoa**: Kasoa, Central Region

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
