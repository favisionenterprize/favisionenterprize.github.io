# FA Vision Autopilot (browser add-on)

Works with the admin's **Social autopilot** (Facebook and Instagram) and **Price sync** screens. Facebook and Instagram have no free API for Marketplace renewals, group posts or posting from a personal setup like this, so this add-on does the clicking in your own logged-in Chrome.

## Install (one time, in Microsoft Edge)

1. Download this `extension` folder (GitHub → Code → Download ZIP, then unzip) and keep it somewhere it won't be deleted.
2. Open `edge://extensions` and turn on **Developer mode** (left side of the page). Remove any older FA Vision add-on first.
3. Click **Load unpacked** and choose the folder.
4. Keep Developer mode on. If **Details** under FA Vision Autopilot shows **Allow user scripts**, turn it on. This lets the add-on update itself.
5. Show it in the toolbar (Extensions button → eye icon). Stay logged in to Facebook (personal profile) and to Instagram (@favisionent) in this Edge.

It also works the same way in Chrome (`chrome://extensions`).

## Updates happen by themselves (version 5+)

The scripts that do the work on Facebook and Instagram (`autopilot.js`, `facebook.js`, `instagram.js`, listed in `live.json`) are downloaded from the live website every hour and before every run, and run as browser "user scripts". Push a change to the website and every installed add-on picks it up, with no download or reload. The admin's Today tab shows whether self-updating is on.

If user scripts aren't allowed, or the site can't be reached, the add-on falls back to the copies in this folder.

Only changes to `background.js`, `admin.js` or `manifest.json` (the add-on's frame, which rarely changes) need the folder replaced and ↻ reload clicked in `edge://extensions`.

## Runs when minimised or the screen is locked (version 5.2+)

- While a run is going, the add-on asks Windows to keep the screen and PC awake, so the PC doesn't fall asleep or lock itself by timeout mid-run. When the run ends this is released.
- You can minimise Edge or lock the screen yourself (Windows key + L): the run keeps going. The scripts wait through the add-on's background, because Edge slows timers in hidden tabs to once a minute.
- Run tabs are marked so Edge doesn't put them to sleep.
- It can't run while the PC is asleep, hibernating or shut down. On a laptop, keep it plugged in and set **Settings → System → Power → When plugged in, put my device to sleep after: Never** (and the lid action to **Do nothing** if you close the lid).
- In Edge, also add `facebook.com`, `instagram.com`, `x.com`, `tiktok.com`, `youtube.com` and `favisionenterprize.github.io` to **Settings → System and performance → Never put these sites to sleep**.

Updating from 5.1: replace the folder with the new `extension` folder and click **↻ Reload** in `edge://extensions` once (5.2 adds the "keep awake" permission).

## What it does

- **Badge and reminder.** Once an hour it reads your live site's `data/facebook-autopilot.json` and `data/products.json`. The red number on its icon shows Marketplace listings due for renewal, plus 1 if today's group posts haven't run. It sends one reminder a day. Click the icon to open the autopilot screen.
- **Renew.** Opens **Your listings** (marketplace/you/selling), reads every listing and its date, and for each one 7+ days old opens **More options → Renew listing**. Works in batches (20 by default) with a 2-minute pause. Facebook must be on your personal profile; Pages can't use Marketplace.
- **Test without posting.** Runs every step in one group (caption, photo, Post button ready) but never taps Post.
- **Group posts.** Posts today's listing into its next groups: types the caption, attaches the first photo, taps **Post**, then waits 1–3 minutes before the next group.
- **Import groups.** Reads your joined groups from facebook.com/groups/joins.
- **Instagram.** Checks Instagram is logged in as @favisionent and reads its follower, following and post counts. Then it posts each queued photo: Create → Post → photo → keeps the full 4:5 picture → caption → switches **Share to Facebook** off → Share, waiting 2–5 minutes between posts. Test mode does everything except Share.
- **One-button run.** The admin's **Run everything for today** hands the add-on a chain: renew → group posts → Instagram. Each step passes the rest back to the admin, which starts the next one and finally emails the day's report.
- **Daily run.** If switched on in the admin's Today tab, opens the admin at your chosen time and runs everything, report included.
- **Safety.** It stops straight away and reports back if Facebook or Instagram shows any warning ("temporarily blocked", "try again later", "action blocked" and so on). A warning on one site doesn't stop the next site in the one-button run. Every page it works on shows a **Stop** button.

It only acts in a tab the admin opened with a job (the admin hands the job to this add-on, which keeps it per tab, so Facebook's www → web.facebook.com redirect can't lose it). Normal Facebook browsing is untouched.

