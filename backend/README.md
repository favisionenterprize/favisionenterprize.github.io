# Backend: Google Sheet + Apps Script

The backend is a Google Sheet with an Apps Script attached. It costs nothing, needs no billing account, and keeps running without any server to maintain.

| Tab | What it holds |
|---|---|
| **Enquiries** | Quote requests from the website form (you also get an email for each one) |
| **Clients** | Your mailing list: proprietors, offices, past customers |
| **Sales** | Each sale; totals and balances calculate automatically |
| **Expenses** | Materials, wages, transport, rent |
| **Summary** | Total sales, cash received, outstanding balances, profit, monthly sales vs expenses |
| **CampaignLog** | Every campaign email sent, with the result |
| **Orders** | Every website order and payment: option chosen, amount paid online, balance, delivery, Paystack verification, progress |

## One-time setup (about 10 minutes)

1. Create a new Google Sheet named **FA Vision Backend** at <https://sheets.new>.
2. Open **Extensions → Apps Script**. Delete the sample code and paste in [`apps-script/Code.gs`](apps-script/Code.gs).
3. Click **Project Settings** (gear icon), tick **Show "appsscript.json"**, then replace that file's contents with [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Back in the editor, select **`setup`** from the function list and click **Run**. Approve the permissions prompt. This creates all the tabs.
5. Click **Deploy → New deployment → Web app**. Set *Execute as: Me* and *Who has access: Anyone*, then deploy and copy the **Web app URL**.
6. Put that URL in [`data/business.json`](../data/business.json) as `"enquiry_endpoint"`, run `python3 scripts/generate_listings.py`, and commit. The website's **Custom orders** form now also saves each request into the **Enquiries** tab (it still opens WhatsApp too).
7. Optional: `NOTIFY_EMAIL` (in **Project Settings → Script properties**) is set to your address by `setup`; change it if enquiry alerts should go elsewhere. Emails link to the live website; set `SITE_URL` there only if the address changes.

## Orders & payments

Every website order lands in the **Orders** tab and in your email, and shows on the website admin under **Orders & payments** (`/admin/` → *Orders & payments*). That covers pay in full, 50% deposit, pay on delivery and walk in. Online payments are recorded three ways, so none are missed:

1. the website sends the order when the customer finishes checkout;
2. Paystack calls the backend the moment a payment succeeds, even if the customer closes the page (webhook, step 3 below);
3. `syncPaystack` runs every hour and adds any Paystack payment still missing.

Each online payment is confirmed with Paystack's API and re-priced from your catalogue. Anything that doesn't check out is marked **UNVERIFIED**, **NOT FOUND** or **UNDERPAID** and appears under **Needs checking** in the admin.

One-time setup, after the steps above:

1. **Update the code.** Paste the latest [`apps-script/Code.gs`](apps-script/Code.gs) over the old one and save. Run **`setup`** again and approve the new permissions. It adds the **Orders** tab, creates an **ADMIN_KEY** and starts the hourly Paystack sync.
2. **Add your Paystack secret key.** In **Project Settings → Script properties**, add `PAYSTACK_SECRET_KEY` = your `sk_live_…` key (or `sk_test_…` while testing). It only ever lives here, never on the website.
3. **Point Paystack at the backend.** In Paystack, open **Settings → API Keys & Webhooks** and set **Live Webhook URL** (and Test Webhook URL) to your web app URL.
4. **Publish the new version.** **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. This keeps the same web app URL.
5. **Open the admin Orders screen.** On the website admin, tap **Orders & payments** and paste the **ADMIN_KEY** from Script properties. Change an order's progress there (Confirmed → Delivered → Balance paid) and it saves to the Sheet.

Manual MoMo transfers (to your MoMo number, without Paystack) are recorded as orders marked **UNVERIFIED**. Check your wallet for the reference, then move the order along in the admin.

If your phone numbers or address change, update the `BUSINESS` block at the top of `Code.gs` as well as `data/business.json`.

## SMS alerts to your phone

The backend texts you for every customer request: website enquiries, taps on any WhatsApp button (including the student-desk promo order), checkout orders (MoMo, card, deposit, pay on delivery, walk in) and invoice requests. Email alerts keep working as before.

1. Create an account at [arkesel.com](https://arkesel.com) (Ghana SMS provider) and top up a small amount. Texts are paid per message, roughly a few pesewas each.
2. Request a sender ID such as `FAVision` (max 11 characters) and wait for approval.
3. In **Apps Script → Project Settings → Script properties**, add:
   - `SMS_API_KEY`: your Arkesel API key
   - `SMS_TO`: the number(s) to alert, comma separated, e.g. `233572646176,233207473267`
   - `SMS_SENDER`: your approved sender ID (defaults to `FAVision`)
4. Paste the updated `Code.gs`, then **Deploy → Manage deployments → Edit → New version → Deploy** so the website uses it.
5. Run `testSms` once from the editor. You should get a test text within a minute.

Nothing is sent until `SMS_API_KEY` and `SMS_TO` are set, and alerts are capped at 40 texts an hour.

## Invoices

1. Paste the latest `Code.gs`, save, run **`setup`** again (it adds the **Invoices** tab) and approve the new **Google Drive** permission. The script saves invoice PDFs to a Drive folder called **FA Vision Invoices** and shares each one by link.
2. **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy** (same URL).
3. Invoice numbers continue from **100683** (the paper series PINV100683). To start elsewhere, set the script property **INVOICE_SEQ** to the last number used.
4. In the website admin open **Invoices**, paste the same **ADMIN_KEY** as for Orders, and requests from the website appear there. **Generate invoice** numbers it, saves the PDF, emails it to the customer (if ticked) and fills in the row.


## Customers (CRM) and WhatsApp replies

**/admin/ → Customers** shows everyone who sent an enquiry, placed an order or asked for an invoice, as one card per person (matched by phone number, so `024…`, `+233 24…` and `23324…` count as the same customer). On each card you can:

- move an enquiry along **New → Contacted → Quoted → Won / Lost**,
- add a dated note and a **follow-up date** (cards whose date has come are flagged "Follow up"),
- pick a ready-made **WhatsApp reply** (price, photos, how to pay, delivery update, balance reminder, thank you, follow up) and send it in one tap,
- see order history, total spent, balance owed and invoice PDFs.

Anyone who only tapped a WhatsApp button on the website has no phone number yet, so they are counted at the top ("WhatsApp chats opened") rather than listed.

**To turn it on** (one time, after this update): open the Apps Script project, replace `Code.gs` with the new `backend/apps-script/Code.gs`, save, then **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. The web app URL does not change, so nothing else needs updating. The Enquiries tab gets two new columns, **Notes** and **FollowUp**, the first time you save a note.

## Admin sign-in: email, password and "Forgot password" code

The website admin (`/admin/`) signs in with your email and a password instead of a GitHub token. **Forgot password** emails a 6-digit code (valid 10 minutes) to the admin email only; you type the code and choose a new password. The GitHub token lives only in Apps Script, never on your phone or in any email, and every product save goes through the backend. One sign-in also unlocks Orders, Customers and Invoices, so you no longer paste the ADMIN_KEY.

One-time setup (about 5 minutes):

1. **Update the code.** In Apps Script, paste the latest [`apps-script/Code.gs`](apps-script/Code.gs) over the old one and save.
2. **Add two Script properties** (**Project Settings → Script properties → Add script property**):
   - `GITHUB_TOKEN`: a fine-grained GitHub token with **Contents: Read and write** on `favisionenterprize.github.io` only. See *How do I get a token?* on the admin sign-in page.
   - `ADMIN_EMAIL`: `nanaotengdonkor1@gmail.com`. If you leave it out, that address is used anyway. Only this address can sign in or receive reset codes.
3. **Publish the new version.** **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. The web app URL stays the same. Approve the permissions prompt if one appears (the script now calls GitHub).
4. **Set your password.** Open `/admin/`, tap **Forgot password? · First time? Set a password**, tap **Email me a code**, and enter the code from your Gmail with a new password (8+ characters). You're signed in.
5. **Remove the old token from your phone.** Once email sign-in works, you can delete any GitHub token you made earlier for pasting on the phone.

Safety built in: the reset email always goes to `ADMIN_EMAIL`, whatever address is typed. Codes are single-use and expire after 10 minutes, and one can be requested per minute. Five wrong passwords or codes lock sign-in for 15 minutes. Setting a new password signs out every other device. Passwords are stored salted and hashed, never in plain text.

Locked out and the email isn't arriving? In Apps Script, run **`resetAdminPassword`** once from the function list, then use *Forgot password* again. The old GitHub-token sign-in is still under **Backup** on the sign-in page.

## Daily posting report (Social autopilot)

Every day the backend emails a breakdown of what the Social autopilot did: Marketplace renewals, Facebook group posts, Instagram posts, follower growth, anything that failed or was stopped, and a 7-day table. A CSV of every action is attached for audit.

- It's sent **right after the admin's one-button run** ("Run everything for today"), and again **every night at about 9 pm** if anything happened after the last report (or nothing happened at all that day, so a quiet day is on record too).
- It goes to `nanaotengdonkor1@gmail.com`. To send it somewhere else, add the Script property `REPORT_EMAIL`.
- **To switch it on:** paste the latest `Code.gs` into Apps Script, **Deploy → Manage deployments → Edit → New version → Deploy**, then run `setup()` once (it adds the 9 pm trigger). Run `testPostingReport()` to get a sample straight away.
- The "after the run" email needs you signed in to the admin with email and password. With GitHub-token sign-in you still get the 9 pm one.

## Posting alerts (before every posting session)

The admin calls `session_alert` just before the Facebook group posts start. It emails REPORT_EMAIL with today's listing, the groups being posted into, new groups joined today and groups removed for declining our posts. On the day the daily new-group target (20) is reached, a separate 🎉 email goes out, once per day. This needs the latest Code.gs and a new deployment. No extra setup.

## Muse AI (phone app at /muse/)

Muse signs in with the same email and password as /admin/ and asks the backend (`muse` action) for its AI answers, so no key is stored on the phone. To switch the AI on, add **one** Script property (Apps Script → Project settings → Script properties):

- `GEMINI_API_KEY`: free key from https://aistudio.google.com/apikey (recommended). Optional `GEMINI_MODEL`, default `gemini-2.5-flash`.
- or `ANTHROPIC_API_KEY`: Claude key from https://console.anthropic.com. Optional `CLAUDE_MODEL`, default `claude-haiku-4-5-20251001`.

Without a key, Muse's Create tab still works using built-in templates. Usage is capped at 120 AI requests an hour.

## Sending a batch email campaign

1. Fill the **Clients** tab. You can paste from [`marketing/clients-template.csv`](../marketing/clients-template.csv). Set **Segment** to `Proprietor` for school owners.
2. Run **`previewCampaign`**. It sends the email to you only, so you can check it.
3. Run **`sendCampaign`**. It emails every Proprietor with an email address who hasn't unsubscribed or already received this campaign.
4. For long lists, run **`scheduleDailyCampaign`** once. It sends at 9am each day until everyone has been reached.

Limits and rules:
- A free Gmail account can send to about **100 recipients a day** from Apps Script (Google Workspace: 1,500). The script stops at the limit and continues on the next run, and never emails the same person twice for one campaign.
- Every email includes an **unsubscribe** link. Clicking it marks the client `Unsubscribed` and they are skipped from then on. Only email schools that gave you their address or publish it for business enquiries.
- Edit the wording in the `CAMPAIGNS` section of `Code.gs`. Copy a campaign block and give it a new id for the next promotion.

## Moving to Cloud Run / BigQuery later

When a billing account is linked to the Google Cloud project, the Sheet can feed BigQuery (**Connected Sheets**, or a BigQuery external table on the Sheet) for heavier reporting, and the enquiry endpoint can move to Cloud Run. Nothing on the website changes except `enquiry_endpoint`.

## Seek (fresh photos and descriptions)

The admin's **🔎 Seek** screen calls two backend actions: `seek` (searches photos and writes new descriptions) and `seek_fetch` (downloads the photos you approve). After pasting the new Code.gs, deploy it again (Deploy → Manage deployments → edit → New version).

- Photos: Openverse public-domain/CC0 photos work with no key. For many more furniture photos, get a free key at pexels.com/api and add the Script property `PEXELS_API_KEY`.
- Descriptions: uses `GEMINI_API_KEY` (Google Search grounding) or `ANTHROPIC_API_KEY` (web search), the same keys as Muse AI.
- Nothing is changed on the website by the backend; only your "Approve & publish" in the admin does that.
