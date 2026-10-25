// FA Vision shared dialog handler (live script, loaded via extension/live.json on every site the add-on works on,
// BEFORE the posting / engagement scripts). Defines window.FAV_DIALOGS; every add-on script calls it:
//   FAV_DIALOGS.tick(ctx)  → in its waitFor/countdown loops, right before every Post/Share/Publish/Save click and while
//                            waiting for the confirmation. ctx = { ours: () => bool (our unsent text in the composer) }.
//                            Returns { stop: "<reason>" } for a dialog that must stop the run, else null (anything
//                            harmless is dismissed and logged).
//   FAV_DIALOGS.log()      → the handled dialogs for this page (job results carry them as `dialogs[]`).
// A MutationObserver also handles harmless popups the moment they appear (between ticks).
//
// AUTO-HANDLED (dismiss / decline, then carry on with the same step): notification prompts, "Not now", "Save login
// info?", add to home screen, "Try the app", tours / tooltips / "Got it" / "What's new" / TikTok Studio tips, Boost /
// Promote offers (declined: Boost stays OFF), Instagram "Share to Facebook too?" (off), cookie / consent banners (decline
// non-essential), language / region prompts (close), soft "you're posting a lot / slow down" notices that only offer OK
// (OK; the run keeps its normal pace), X "Add image description" (Not this time), "Discard post?" (Discard ONLY when it
// is our own unsent text in this job, else Keep editing / Cancel: the user's older drafts are never discarded), and an
// unknown dialog with ONE obvious close (X / Close / Cancel / Not now): closed, its text recorded.
// STOP (never clicked through, the run stops as before): security checks, confirm your identity, suspicious activity,
// log in / password / 2FA / CAPTCHA, temporarily blocked / restricted, "we limit how often", community standards /
// policy / "goes against" / account quality notices, new Terms to accept, pay / subscribe (Meta Verified) / add a
// payment method, grant permissions / OAuth, Delete / irreversible confirmations not started by our own step.
// "No access to post" is left to autopilot.js (its profile switch), so it is neither handled nor stopped here.
// beforeunload ("Leave site?") raised while OUR script navigates: the script's own navigation is marked with
// FAV_DIALOGS.leaving(), and the page's beforeunload handlers are skipped for that one navigation.
(function () {
  if (window.FAV_DIALOGS) return;
  const VERSION = "2026-10-25.1";
  const visible = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const txt = el => String((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  const label = b => (txt(b) || b.getAttribute("aria-label") || b.getAttribute("title") || "").trim();

  const STOP = [
    [/security check|confirm (it('|’)s you|your identity)|verify (it('|’)s you|your (identity|account))|suspicious (activity|login)|unusual (activity|login)|checkpoint|captcha|i('|’)m not a robot|prove you('|’)re (human|not a robot)|two-factor|2fa|authentication code|login code|enter (the )?code we sent|re-?enter your password|log ?in to continue|session expired/i, "security / login check"],
    [/temporarily (blocked|restricted|locked)|you('|’)re (temporarily )?(blocked|restricted)|your account (has been |is )?(restricted|suspended|disabled|locked)|we limit how often|action blocked|you can('|’)t use this feature/i, "account limited"],
    [/community (standards|guidelines)|goes against our|violat(es|ion)|account (quality|status)|policy (warning|violation)|removed your (post|content)|restricted from/i, "policy / account-quality warning"],
    [/accept (the |our )?(new )?terms|updated (our )?terms|terms of (service|use) (have|has) changed/i, "new terms to accept"],
    [/meta verified|subscribe|subscription|add (a )?payment|payment method|billing|pay now|start (your )?free trial|upgrade to premium|x premium|go premium/i, "payment / subscription"],
    [/(allow|grant) (access|permission)|wants to access your|authori[sz]e (the )?app|connect (your )?account to/i, "permission / app access"]
  ];
  // Harmless dialogs: [text pattern, button pattern (the safe choice), note]
  const SAFE = [
    [/turn on notifications|get notifications|enable notifications|allow notifications/i, /^(not now|no thanks|later|cancel|dismiss|close|skip)$/i, "notifications prompt"],
    [/save (your )?login info|remember (this browser|me|your login)|save password/i, /^(not now|no|don('|’)t save|cancel|skip)$/i, "save login prompt"],
    [/add to home screen|install (the )?app|try the app|open in app|get the app|use the app/i, /^(not now|no thanks|cancel|dismiss|close|continue (on|in) (web|browser)|stay on web)$/i, "app prompt"],
    [/boost (this|your) post|boost post|promote (this|your)|get more (views|reach) with|turn on boost/i, /^(not now|no thanks|skip|cancel|close|maybe later|dismiss)$/i, "Boost / Promote offer declined"],
    [/share (to|on) facebook (too)?|also share to facebook|share your posts to facebook/i, /^(not now|no|don('|’)t share|skip|cancel|turn off)$/i, "Share to Facebook: off"],
    [/cookies|cookie (settings|policy)|we use cookies|consent/i, /^(decline (optional|non-essential|all)|reject (all|optional|non-essential)( cookies)?|only (allow )?(essential|necessary|required)( cookies)?|necessary only|decline)$/i, "cookies: essential only"],
    [/choose (your )?language|select (your )?(language|region|country)|change (your )?(language|region)/i, /^(close|not now|cancel|keep|skip|dismiss)$/i, "language / region prompt"],
    [/you('|’)re posting (a lot|too fast)|slow down|posting frequently|take a break/i, /^(ok|okay|got it|i understand)$/i, "slow-down notice (kept the normal pace)"],
    [/add (an )?image description|add alt text|describe (this|your) image/i, /^(not this time|not now|skip|cancel)$/i, "image description prompt"],
    [/what('|’)s new|new feature|introducing|tips? for|getting started|welcome to|take a tour|quick tour|here('|’)s how|learn more about|try (our|the) new/i, /^(got it|ok|okay|skip|close|not now|dismiss|done|maybe later|next time|no thanks)$/i, "tour / tips"]
  ];
  const DISCARD = /discard (post|edits|changes|draft)\??|discard this|leave without (saving|posting)|unsaved changes|you have unsaved/i;
  const CLOSE = /^(close|cancel|not now|no thanks|dismiss|×|x|✕|skip)$/i;
  const DESTRUCT = /^(delete|remove|discard|unfollow|block|leave group|deactivate|log out|sign out|report)/i;

  const log = [];
  let leavingUntil = 0, busyUntil = 0, ctx0 = {}, ourClickAt = 0;
  // Clicks made by our scripts are untrusted events. A dialog that opens within 5 s of one is the answer to OUR step
  // (a menu we opened, a confirmation we asked for): only the known-harmless and STOP rules apply to it, never the
  // generic "close an unknown dialog" or "unexpected confirmation" rules.
  document.addEventListener("click", e => { if (!e.isTrusted && !e.__favDialog) ourClickAt = Date.now(); }, true);
  function note(kind, text, clicked) {
    const t = String(text || "").slice(0, 140);
    if (log.some(x => x.text === t && x.clicked === clicked && Date.now() - x.at < 5000)) return;
    log.push({ at: Date.now(), kind, text: t, clicked });
    try { sessionStorage.setItem("fav-dialogs", JSON.stringify(log.slice(-30))); } catch (e) { /* storage blocked */ }
  }
  try { (JSON.parse(sessionStorage.getItem("fav-dialogs") || "[]") || []).forEach(x => log.push(x)); } catch (e) { /* */ }

  function surfaces() {
    // dialogs / alert dialogs / banners / tooltips that are on screen
    const sel = "[role=dialog],[role=alertdialog],[aria-modal=true],[data-testid=sheetDialog],[data-testid=confirmationSheetDialog],[role=tooltip],[data-e2e*=tooltip],[data-tt*=Tooltip],[class*=cookie],[id*=cookie],[class*=consent],[data-testid=cookie-policy-manage-dialog],[data-cookiebanner]";
    return [...document.querySelectorAll(sel)].filter(visible).filter(d => !d.closest("#favautobox,#favsyncbox,[id^=favauto]"));
  }
  const buttonsIn = d => [...d.querySelectorAll("button,[role=button],a[role=link],a[href],[role=menuitem]")].filter(visible).filter(b => label(b).length <= 40 || b.getAttribute("aria-label"));
  function click(b) { try { const ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window }); ev.__favDialog = true; b.dispatchEvent(ev); } catch (e) { try { b.click(); } catch (x) { /* */ } } }

  // ctx.ours(): true when the composer holds OUR unsent text from this job (then "Discard post?" may discard it).
  // ctx.ourAction: a regex of what our own step just asked for (e.g. /delete listing/ never: we never delete), used
  // to tell "a Delete confirmation we started" from one we didn't (we never start one, so Delete always stops).
  function check(ctx) {
    ctx = Object.assign({}, ctx0, ctx || {});
    if (Date.now() < busyUntil) return null;
    for (const d of surfaces()) {
      const t = txt(d).slice(0, 600);
      if (!t) continue;
      const bs = buttonsIn(d);
      // 1. stop: never click through
      for (const [re, why] of STOP) if (re.test(t)) { note("stop", why + ": " + t, null); return { stop: `${why}: “${t.slice(0, 120)}”` }; }
      // 2. discard prompts
      if (DISCARD.test(t)) {
        const ours = typeof ctx.ours === "function" && ctx.ours();
        const want = ours ? /^(discard|discard (post|edits|changes)|leave|don('|’)t save)$/i : /^(keep editing|cancel|continue editing|go back|no|stay)$/i;
        const b = bs.find(x => want.test(label(x)));
        if (b) { click(b); busyUntil = Date.now() + 600; note(ours ? "discard-ours" : "keep-editing", t, label(b)); return null; }
      }
      // 3. known harmless prompts
      let done = false;
      for (const [re, bre, why] of SAFE) {
        if (!re.test(t)) continue;
        const b = bs.find(x => bre.test(label(x)));
        if (b) { click(b); busyUntil = Date.now() + 600; note("handled", why + ": " + t, label(b)); done = true; break; }
      }
      if (done) return null;
      // Instagram "Share to Facebook" toggle inside the share step: switch it off when on.
      const rowOf = x => (x.parentElement || x).closest("label,div,li") || d;   // the row around a switch (not the switch itself)
      const sw = [...d.querySelectorAll("[role=switch][aria-checked=true],input[type=checkbox]:checked")].find(x => /share (to|on) facebook|also share/i.test(txt(rowOf(x)) + " " + (x.getAttribute("aria-label") || "")));
      if (sw) { click(sw); note("handled", "Share to Facebook switched off", "switch"); }
      // Boost toggles inside a publish step stay OFF.
      const boost = [...d.querySelectorAll("[role=switch][aria-checked=true],[role=checkbox][aria-checked=true]")].find(x => /boost/i.test(txt(rowOf(x)) + " " + (x.getAttribute("aria-label") || "")));
      if (boost) { click(boost); note("handled", "Boost switched off", "switch"); }
      // 4. unknown dialog with ONE obvious, non-destructive close → close it, record its text. Composer dialogs (the
      //    ones we type in) are never closed: they hold a text box.
      if (d.querySelector("[contenteditable=true],textarea,input[type=text],input[type=file],input[type=search],input:not([type])")) continue;
      if (Date.now() - ourClickAt < 5000) continue;
      const closes = bs.filter(x => CLOSE.test(label(x)) || /^(close|dismiss)$/i.test(x.getAttribute("aria-label") || ""));
      const destructive = bs.some(x => DESTRUCT.test(label(x)));
      if (destructive && !closes.length) { note("stop", "unexpected confirmation: " + t, null); return { stop: `an unexpected confirmation (“${t.slice(0, 100)}”) that wasn't started by our step` }; }
      if (closes.length === 1 || (closes.length > 1 && new Set(closes.map(x => label(x).toLowerCase())).size === 1)) {
        click(closes[0]); busyUntil = Date.now() + 600; note("closed", t, label(closes[0]) || closes[0].getAttribute("aria-label"));
        return null;
      }
    }
    return null;
  }
  // Watch for harmless popups between ticks (never stops anything itself: the run's next tick does that).
  let pending = false;
  const mo = new MutationObserver(() => { if (pending) return; pending = true; setTimeout(() => { pending = false; try { check(); } catch (e) { /* */ } }, 250); });
  const start = () => { try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) { /* */ } };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });
  // Our own navigation: skip the page's "Leave site?" prompt for that one navigation.
  window.addEventListener("beforeunload", e => { if (Date.now() < leavingUntil) { e.stopImmediatePropagation(); note("handled", "Leave site? (our own navigation): stayed on course", "leave"); } }, true);

  window.FAV_DIALOGS = {
    VERSION,
    tick: ctx => check(ctx),
    log: () => log.map(x => ({ kind: x.kind, text: x.text, clicked: x.clicked })),
    leaving: () => { leavingUntil = Date.now() + 4000; },
    context: c => { ctx0 = Object.assign({}, ctx0, c || {}); },
    _test: { STOP, SAFE, check }
  };
})();
