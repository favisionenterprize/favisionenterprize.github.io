/**
 * FA Vision Enterprise backend (Google Apps Script, bound to a Google Sheet).
 *
 * - doPost: receives website enquiries into the "Enquiries" tab, website
 *   orders (MoMo / card / deposit / pay on delivery / walk in) into "Orders",
 *   Paystack webhooks, and order-progress updates from /admin/.
 *   Paystack payments are verified server-side with PAYSTACK_SECRET_KEY.
 * - doGet: unsubscribe links, and the order and invoice lists for /admin/.
 * - Invoices: customers request invoices on the website ("Invoices" tab);
 *   /admin/ turns a request into a numbered invoice, and this script saves it
 *   as a PDF in Drive ("FA Vision Invoices" folder) and emails it.
 * - syncPaystack: hourly, adds any Paystack payment missing from "Orders".
 * - doGet:  handles unsubscribe links from campaign emails.
 * - Sales / Expenses / Summary tabs: simple finance records.
 * - sendCampaign: batch-mails clients in the "Clients" tab, within the
 *   daily Gmail quota, and records who was sent what.
 * - Posting report: after the admin's Social autopilot run (and every night
 *   at 9 pm) emails a breakdown of the day's Marketplace renewals, Facebook
 *   group posts and Instagram posts, with a CSV for audit, to REPORT_EMAIL.
 *
 * Run setup() once after pasting this file (see backend/README.md).
 */

// Keep in step with data/business.json in the website repository.
const BUSINESS = {
  name: 'F.A Vision Enterprise',
  address: 'Tarazzo Road, opposite Pacific, Odorkor, Accra',
  email: 'favisionenterprise1@gmail.com',
  whatsapp: '233572646176',
  phones: '057 264 6176 / 020 747 3267 / 054 614 8923',
  website: 'https://favisionenterprize.github.io/',
};

const SHEETS = {
  ENQUIRIES: 'Enquiries',
  CLIENTS: 'Clients',
  SALES: 'Sales',
  EXPENSES: 'Expenses',
  SUMMARY: 'Summary',
  CAMPAIGN_LOG: 'CampaignLog',
  ORDERS: 'Orders',
  INVOICES: 'Invoices',
};

const HEADERS = {
  Enquiries: ['Timestamp', 'Name', 'Organisation', 'Phone', 'Email', 'Product', 'Quantity', 'Message', 'Source', 'Status', 'Notes', 'FollowUp'],
  Clients: ['Name', 'Organisation', 'Email', 'Phone', 'Segment', 'Area', 'Status', 'LastCampaign', 'LastSentAt', 'Token'],
  Sales: ['Date', 'Customer', 'Product', 'Quantity', 'UnitPriceGHS', 'TotalGHS', 'AmountPaidGHS', 'BalanceGHS', 'Notes'],
  Expenses: ['Date', 'Category', 'Description', 'AmountGHS', 'PaidTo', 'Notes'],
  CampaignLog: ['Timestamp', 'Campaign', 'Email', 'Result'],
  Orders: ['Timestamp', 'Reference', 'Customer', 'Phone', 'Email', 'Product', 'Quantity', 'UnitPriceGHS', 'TotalGHS',
    'PaymentOption', 'Method', 'PaidNowGHS', 'BalanceGHS', 'Delivery', 'Status', 'Verification', 'Notes', 'Progress'],
  Invoices: ['Timestamp', 'RequestId', 'Kind', 'OrderRef', 'Customer', 'Organisation', 'Phone', 'Email', 'Address', 'TIN', 'PO',
    'Items', 'Status', 'InvoiceNo', 'InvoiceDate', 'TotalGHS', 'BalanceGHS', 'PdfUrl', 'Notes'],
};

// ---------- Setup ----------

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach((name) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
    }
  });

  // Row formulas for Sales totals and balances.
  const sales = ss.getSheetByName(SHEETS.SALES);
  sales.getRange('F2').setFormula('=ARRAYFORMULA(IF(D2:D="",,D2:D*E2:E))');
  sales.getRange('H2').setFormula('=ARRAYFORMULA(IF(D2:D="",,F2:F-G2:G))');

  const summary = ss.getSheetByName(SHEETS.SUMMARY) || ss.insertSheet(SHEETS.SUMMARY);
  summary.clear();
  summary.getRange('A1:B1').setValues([['Metric', 'Value']]).setFontWeight('bold');
  summary.getRange('A2:B8').setValues([
    ['Total sales (GHS)', '=SUM(Sales!F2:F)'],
    ['Cash received (GHS)', '=SUM(Sales!G2:G)'],
    ['Outstanding balances (GHS)', '=SUM(Sales!H2:H)'],
    ['Total expenses (GHS)', '=SUM(Expenses!D2:D)'],
    ['Profit, cash basis (GHS)', '=B3-B5'],
    ['Open enquiries', '=COUNTIF(Enquiries!J2:J,"New")'],
    ['Clients reachable by email', '=COUNTIFS(Clients!C2:C,"?*",Clients!G2:G,"<>Unsubscribed")'],
  ]);
  summary.getRange('A10').setValue('Monthly sales vs expenses').setFontWeight('bold');
  summary.getRange('A11').setFormula(
    '=QUERY({ARRAYFORMULA(IF(Sales!A2:A="",,TEXT(Sales!A2:A,"yyyy-mm"))),Sales!F2:F},' +
    '"select Col1, sum(Col2) where Col1 is not null group by Col1 label Col1 \'Month\', sum(Col2) \'Sales (GHS)\'",0)'
  );
  summary.getRange('D11').setFormula(
    '=QUERY({ARRAYFORMULA(IF(Expenses!A2:A="",,TEXT(Expenses!A2:A,"yyyy-mm"))),Expenses!D2:D},' +
    '"select Col1, sum(Col2) where Col1 is not null group by Col1 label Col1 \'Month\', sum(Col2) \'Expenses (GHS)\'",0)'
  );

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('NOTIFY_EMAIL')) {
    props.setProperty('NOTIFY_EMAIL', Session.getEffectiveUser().getEmail());
  }
  // Admin key for the website's /admin/ Orders screen.
  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  }
  // Hourly Paystack sync (safety net for payments whose customer closed the page).
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'syncPaystack')) {
    ScriptApp.newTrigger('syncPaystack').timeBased().everyHours(1).create();
  }
  // Nightly posting report (Social autopilot) at about 9 pm.
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'sendPostingReport')) {
    ScriptApp.newTrigger('sendPostingReport').timeBased().everyDays(1).atHour(21).create();
  }
  Logger.log('Admin key for the Orders screen: ' + props.getProperty('ADMIN_KEY'));
}

// ---------- Web endpoints ----------

function doPost(e) {
  let data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  if (data.website) return json_({ ok: true }); // honeypot
  // Paystack webhook. Apps Script can't read the signature header, so the
  // payment is re-checked with Paystack's API before anything is recorded.
  if (data.event) {
    if (data.event === 'charge.success' && data.data && data.data.reference) upsertPaystackPayment_(data.data.reference);
    return json_({ ok: true });
  }
  // Admin sign-in (email + password, reset code by email) and the GitHub proxy.
  if (data.action === 'login') return adminLogin_(data);
  if (data.action === 'forgot') return adminForgot_(data);
  if (data.action === 'reset') return adminReset_(data);
  if (data.action === 'logout') return adminLogout_(data);
  if (data.action === 'session') return json_(sessionValid_(data.session) ? { ok: true } : { ok: false, error: 'signed_out' });
  if (data.action === 'github') return githubProxy_(data);
  if (data.action === 'posting_report') return postingReportNow_(data);
  if (data.action === 'session_alert') return sessionAlert_(data);
  if (data.action === 'muse') return museAsk_(data);
  if (data.action === 'update_order') return updateOrder_(data);
  if (data.action === 'save_invoice') return saveInvoice_(data);
  if (data.action === 'update_enquiry') return updateEnquiry_(data);
  if (!data.name) return json_({ ok: false, error: 'name required' });
  if (data.action === 'invoice_request') return recordInvoiceRequest_(data);
  if (data.action === 'order') return recordOrder_(data);

  const clean = (v) => String(v || '').slice(0, 1000).replace(/^[=+\-@]/, "'$&");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    SpreadsheetApp.getActive().getSheetByName(SHEETS.ENQUIRIES).appendRow([
      new Date(), clean(data.name), clean(data.organisation), clean(data.phone), clean(data.email),
      clean(data.product), Number(data.quantity) || '', clean(data.message), clean(data.source), 'New',
    ]);
  } finally {
    lock.releaseLock();
  }

  sendSms_(data.source === 'whatsapp'
    ? `FA Vision: WhatsApp chat opened${data.product ? ' (' + clean(data.product) + ')' : ''}: ${clean(data.message)}`
    : `FA Vision: New enquiry from ${clean(data.name)} ${clean(data.phone)}: ${clean(data.product)} ${clean(data.message)}`);
  const notify = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (notify) {
    MailApp.sendEmail(notify, `New enquiry: ${clean(data.product) || 'website'} from ${clean(data.name)}`,
      `Name: ${clean(data.name)}\nOrganisation: ${clean(data.organisation)}\nPhone: ${clean(data.phone)}\n` +
      `Email: ${clean(data.email)}\n\n${clean(data.message)}`);
  }
  return json_({ ok: true });
}

// ---------- SMS alerts ----------
// Texts the owner for every customer request: enquiries, WhatsApp taps, promo orders,
// checkout orders (incl. walk in / pay on delivery) and invoice requests.
// Uses Arkesel (arkesel.com, Ghana). Script properties:
//   SMS_API_KEY  your Arkesel API key (Dashboard -> SMS API -> API keys)
//   SMS_TO       number(s) to alert, comma separated, e.g. 233572646176,233207473267
//   SMS_SENDER   approved sender ID, max 11 characters (default FAVision)
// Nothing is sent until SMS_API_KEY and SMS_TO are set. Capped at 40 texts an hour.
function sendSms_(text) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('SMS_API_KEY');
    const to = String(props.getProperty('SMS_TO') || '').split(',')
      .map((n) => n.replace(/\D/g, '').replace(/^0/, '233')).filter((n) => n.length >= 12);
    if (!key || !to.length) return;
    const cache = CacheService.getScriptCache();
    const slot = 'sms_' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHH');
    const count = Number(cache.get(slot) || 0);
    if (count >= 40) return;
    cache.put(slot, String(count + 1), 3600);
    const message = String(text).replace(/\s+/g, ' ').replace(/^'/, '').trim().slice(0, 300);
    const res = UrlFetchApp.fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'api-key': key },
      payload: JSON.stringify({ sender: (props.getProperty('SMS_SENDER') || 'FAVision').slice(0, 11), message, recipients: to }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) Logger.log('SMS failed: ' + res.getContentText());
  } catch (err) {
    Logger.log('SMS error: ' + err); // never block the request because of SMS
  }
}

// Run once from the editor to check SMS alerts reach your phone.
function testSms() {
  sendSms_('FA Vision: test alert. SMS alerts are working.');
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'unsubscribe' && p.token) {
    const found = markUnsubscribed_(p.token);
    return HtmlService.createHtmlOutput(found
      ? '<p style="font-family:sans-serif">You have been unsubscribed from FA Vision Enterprise emails.</p>'
      : '<p style="font-family:sans-serif">This link is no longer valid.</p>');
  }
  if (p.action === 'orders') {
    if (!checkAdmin_(p.key)) return json_({ ok: false, error: 'not allowed' });
    return json_({ ok: true, orders: listOrders_(), progress: PROGRESS, sheet: SpreadsheetApp.getActive().getUrl() });
  }
  if (p.action === 'customers') {
    if (!checkAdmin_(p.key)) return json_({ ok: false, error: 'not allowed' });
    return json_(Object.assign({ ok: true, statuses: ENQUIRY_STATUS, sheet: SpreadsheetApp.getActive().getUrl() }, listCustomers_()));
  }
  if (p.action === 'invoices') {
    if (!checkAdmin_(p.key)) return json_({ ok: false, error: 'not allowed' });
    return json_({ ok: true, requests: listInvoices_(), next: nextInvoiceNumbers_(), sheet: SpreadsheetApp.getActive().getUrl() });
  }
  return json_({ ok: true, service: 'FA Vision Enterprise backend' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Website orders & payments ----------
//
// Every order and payment lands in the "Orders" tab, whichever way it arrives:
//   1. the website posts the order when the customer finishes checkout;
//   2. Paystack calls this web app (webhook) when a payment succeeds, even if
//      the customer closed the page;
//   3. syncPaystack() runs every hour and adds any Paystack payment still missing.
// Online payments are always confirmed with Paystack's API before they count.

const ORDER_COL = {};
HEADERS.Orders.forEach((h, i) => { ORDER_COL[h] = i + 1; });
const PROGRESS = ['New', 'Confirmed', 'In production', 'Ready', 'Delivered', 'Balance paid', 'Cancelled'];

const cleanCell_ = (v) => String(v == null ? '' : v).slice(0, 500).replace(/^[=+\-@]/, "'$&");

function ordersSheet_() {
  return SpreadsheetApp.getActive().getSheetByName(SHEETS.ORDERS) || createSheet_(SHEETS.ORDERS);
}

function findOrderRow_(sh, ref) {
  if (sh.getLastRow() < 2) return 0;
  const refs = sh.getRange(2, ORDER_COL.Reference, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < refs.length; i++) if (refs[i][0] === ref) return i + 2;
  return 0;
}

function recordOrder_(data) {
  const ref = cleanCell_(data.reference);
  if (!/^FAV-[A-Z0-9]{6,20}$/.test(ref)) return json_({ ok: false, error: 'bad reference' });

  // Re-price from the live catalogue: the browser's numbers are never trusted.
  const notes = [];
  let product, qty, unit;
  if (Array.isArray(data.items) && data.items.length) {
    // Room Designer orders: several catalogue items in one order, each re-priced.
    qty = 1;
    unit = 0;
    const lines = [];
    data.items.slice(0, 40).forEach((it) => {
      const p = findProduct_(it.id);
      const q = Math.max(1, Math.min(500, parseInt(it.qty, 10) || 1));
      const price = p && p.price_ghs ? Number(p.price_ghs) : Number(it.price_ghs) || 0;
      if (!p) notes.push(`${cleanCell_(it.id)} not found in catalogue; price from website.`);
      unit += price * q;
      lines.push(`${cleanCell_(it.id)}${it.colour ? ' ' + cleanCell_(it.colour) : ''} x${q}`);
    });
    product = { price_ghs: unit };
    data.product = `${data.product}: ${lines.join(', ')}`.slice(0, 500);
  } else {
    product = findProduct_(data.product_id);
    qty = Math.max(1, Math.min(500, parseInt(data.quantity, 10) || 1));
    unit = product && product.price_ghs ? Number(product.price_ghs) : Number(data.unit_price) || 0;
    if (!product) notes.push('Product not found in catalogue; price from website.');
  }
  const total = unit * qty;
  if (Number(data.total) !== total) notes.push(`Website total ${data.total} vs catalogue ${total}.`);

  let verification = 'Not required (nothing paid online)';
  let paidNow = 0;
  let method = cleanCell_(data.method);
  if (Number(data.amount_due) > 0) {
    const v = verifyPaystack_(ref);
    verification = v.note;
    paidNow = v.amount;
    if (v.channel) method = v.channel;
    if (!v.ok && !v.configured) verification = 'UNVERIFIED: check your MoMo wallet / Paystack dashboard';
  }
  if (paidNow && data.plan === 'full' && paidNow + 0.01 < total) notes.push(`UNDERPAID: expected GHS ${total}.`);

  const row = [
    new Date(), ref, cleanCell_(data.name), cleanCell_(data.phone), cleanCell_(data.email),
    cleanCell_(`${data.product} (${data.product_id})`), qty, unit, total,
    cleanCell_(data.plan_label || data.plan), method, paidNow, Math.max(0, total - paidNow),
    cleanCell_(data.area), cleanCell_(data.status), verification, notes.join(' '), 'New',
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let isNew = true;
  try {
    const sh = ordersSheet_();
    const r = findOrderRow_(sh, ref);
    if (r) {
      // The webhook or hourly sync got here first: fill in the customer's details, keep payment facts.
      isNew = false;
      const cur = sh.getRange(r, 1, 1, row.length).getValues()[0];
      const merged = row.map((v, i) => {
        const h = HEADERS.Orders[i];
        if (h === 'Timestamp' || h === 'Progress') return cur[i] || v;
        if (h === 'Notes' || h === 'Status') return v;
        if (h === 'PaidNowGHS' || h === 'BalanceGHS' || h === 'Verification' || h === 'Method') return cur[ORDER_COL.PaidNowGHS - 1] ? cur[i] : v;
        return v || cur[i];
      });
      sh.getRange(r, 1, 1, merged.length).setValues([merged]);
    } else {
      sh.appendRow(row);
    }
  } finally {
    lock.releaseLock();
  }

  if (isNew) notifyOrder_(ref, data.name, data.phone, `${data.product} × ${qty}`, total, data.plan_label || data.plan, paidNow, verification, data.area, notes);
  return json_({ ok: true });
}

function notifyOrder_(ref, name, phone, item, total, plan, paid, verification, area, notes) {
  sendSms_(`FA Vision: New order ${ref}: ${cleanCell_(item)}, GHS ${total}, ${cleanCell_(plan)}. ` +
    `Paid GHS ${paid}. ${cleanCell_(name)} ${cleanCell_(phone)}`);
  const notify = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!notify) return;
  const wa = String(phone || '').replace(/\D/g, '').replace(/^0/, '233');
  MailApp.sendEmail(notify, `New order ${ref}: ${cleanCell_(item)} (${cleanCell_(plan)})`,
    `Customer: ${cleanCell_(name)}\nPhone: ${cleanCell_(phone)}\nItem: ${cleanCell_(item)}\nOrder total: GHS ${total}\n` +
    `Payment: ${cleanCell_(plan)}\nPaid online: GHS ${paid} (${verification})\nBalance: GHS ${Math.max(0, total - paid)}\n` +
    `Delivery: ${cleanCell_(area)}\n` + ((notes || []).length ? `\nNOTES: ${notes.join(' ')}\n` : '') +
    (wa ? `\nWhatsApp the customer: https://wa.me/${wa}\n` : '') +
    `Orders sheet: ${SpreadsheetApp.getActive().getUrl()}`);
}

// Asks Paystack directly whether the payment with this reference succeeded.
// Set PAYSTACK_SECRET_KEY (sk_live_… / sk_test_…) in Project Settings -> Script properties.
// Never put the secret key in the website.
function verifyPaystack_(reference) {
  const key = PropertiesService.getScriptProperties().getProperty('PAYSTACK_SECRET_KEY');
  if (!key) return { ok: false, configured: false, amount: 0, note: 'UNVERIFIED: set PAYSTACK_SECRET_KEY' };
  try {
    const res = UrlFetchApp.fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true,
    });
    const body = JSON.parse(res.getContentText());
    const tx = body && body.data;
    if (!body.status || !tx) return { ok: false, configured: true, amount: 0, note: 'NOT FOUND on Paystack (manual MoMo? check your wallet)' };
    if (tx.status !== 'success' || tx.currency !== 'GHS') return { ok: false, configured: true, amount: 0, note: `Paystack: ${tx.status} ${tx.currency}` };
    const amount = (tx.amount || 0) / 100;
    return { ok: true, configured: true, amount, channel: channelName_(tx), tx, note: `VERIFIED by Paystack: GHS ${amount}` };
  } catch (err) {
    return { ok: false, configured: true, amount: 0, note: 'Verification error: ' + err };
  }
}

function channelName_(tx) {
  if (tx.channel === 'card') return 'Card' + (tx.authorization && tx.authorization.brand ? ` (${tx.authorization.brand})` : '');
  if (tx.channel === 'mobile_money') return 'Mobile Money' + (tx.authorization && tx.authorization.bank ? ` (${tx.authorization.bank})` : '');
  return tx.channel || '';
}

// Records a Paystack payment that isn't in the sheet yet, or marks an existing order verified.
function upsertPaystackPayment_(reference) {
  if (!/^FAV-[A-Z0-9]{6,20}$/.test(String(reference))) return false; // not a website payment
  const v = verifyPaystack_(reference);
  if (!v.ok) return false;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ordersSheet_();
    const r = findOrderRow_(sh, reference);
    if (r) {
      const range = sh.getRange(r, 1, 1, HEADERS.Orders.length);
      const cur = range.getValues()[0];
      if (String(cur[ORDER_COL.Verification - 1]).indexOf('VERIFIED') === 0) return false;
      const total = Number(cur[ORDER_COL.TotalGHS - 1]) || v.amount;
      cur[ORDER_COL.PaidNowGHS - 1] = v.amount;
      cur[ORDER_COL.BalanceGHS - 1] = Math.max(0, total - v.amount);
      cur[ORDER_COL.Method - 1] = v.channel;
      cur[ORDER_COL.Verification - 1] = v.note;
      range.setValues([cur]);
      return true;
    }
    const f = {};
    ((v.tx.metadata && v.tx.metadata.custom_fields) || []).forEach((c) => { f[c.variable_name] = c.value; });
    sh.appendRow([
      new Date(v.tx.paid_at || v.tx.created_at || Date.now()), reference, cleanCell_(f.customer),
      cleanCell_(f.phone), cleanCell_(v.tx.customer && v.tx.customer.email), cleanCell_(f.product), '', '', '',
      cleanCell_(f.plan), v.channel, v.amount, '', cleanCell_(f.delivery), 'Paid (recorded by Paystack)', v.note,
      'Customer did not return to the website after paying; confirm the order details.', 'New',
    ]);
    notifyOrder_(reference, f.customer, f.phone, f.product, v.amount, f.plan, v.amount, v.note, f.delivery,
      ['Recorded from Paystack; the customer did not return to the site.']);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// Hourly safety net: pulls the last 3 days of successful Paystack payments.
function syncPaystack() {
  const key = PropertiesService.getScriptProperties().getProperty('PAYSTACK_SECRET_KEY');
  if (!key) return 0;
  const from = new Date(Date.now() - 3 * 864e5).toISOString();
  const res = UrlFetchApp.fetch(`https://api.paystack.co/transaction?status=success&perPage=100&from=${encodeURIComponent(from)}`, {
    headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true,
  });
  const list = (JSON.parse(res.getContentText()).data) || [];
  let added = 0;
  list.forEach((tx) => { if (upsertPaystackPayment_(tx.reference)) added++; });
  return added;
}

// ---------- Admin API (used by the website's /admin/ Orders screen) ----------

function checkAdmin_(key) {
  const want = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!want && String(key || '') === want;
}

// ---------- Admin sign-in: email + password, reset code by email ----------
//
// The website admin signs in with ADMIN_EMAIL and a password. "Forgot password"
// emails a 6-digit code (valid 10 minutes) to ADMIN_EMAIL only; the code sets a
// new password. The GitHub token never leaves this script: it is stored as the
// script property GITHUB_TOKEN and every product save goes through githubProxy_.
//
// Script properties used:
//   ADMIN_EMAIL    who may sign in and receive reset codes (default below)
//   GITHUB_TOKEN   fine-grained token, Contents: Read and write, this repo only
//   GITHUB_REPO    owner/repo (default favisionenterprize/favisionenterprize.github.io)
// Written by the script: ADMIN_PASS_HASH, ADMIN_PASS_SALT, S_<hash> (sessions).

const DEFAULT_ADMIN_EMAIL = 'nanaotengdonkor1@gmail.com';
const DEFAULT_GITHUB_REPO = 'favisionenterprize/favisionenterprize.github.io';
const SESSION_LONG_MS = 30 * 24 * 3600 * 1000;   // "Keep me signed in": 30 days
const SESSION_SHORT_MS = 12 * 3600 * 1000;       // otherwise 12 hours
const RESET_CODE_SECONDS = 600;                  // reset codes expire after 10 minutes

function authProps_() { return PropertiesService.getScriptProperties(); }
function adminEmail_() { return String(authProps_().getProperty('ADMIN_EMAIL') || DEFAULT_ADMIN_EMAIL).trim().toLowerCase(); }
function normEmail_(v) { return String(v || '').trim().toLowerCase(); }

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// Salted, stretched hash so a leaked property doesn't give away the password.
function hashPassword_(password, salt) {
  let h = sha256Hex_(salt + ':' + password);
  for (let i = 0; i < 2000; i++) h = sha256Hex_(h + salt);
  return h;
}

function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function sameText_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Counts failures per action; blocks for 15 minutes after `max` failures.
function tooManyTries_(bucket, max) {
  return Number(CacheService.getScriptCache().get('fail_' + bucket) || 0) >= max;
}
function noteFailure_(bucket) {
  const cache = CacheService.getScriptCache();
  cache.put('fail_' + bucket, String(Number(cache.get('fail_' + bucket) || 0) + 1), 900);
}

function newSession_(remember) {
  const props = authProps_();
  const now = Date.now();
  // Clear out expired sessions.
  const all = props.getProperties();
  Object.keys(all).forEach((k) => { if (k.indexOf('S_') === 0 && Number(all[k]) < now) props.deleteProperty(k); });
  const token = randomToken_();
  props.setProperty('S_' + sha256Hex_(token).slice(0, 40), String(now + (remember ? SESSION_LONG_MS : SESSION_SHORT_MS)));
  return token;
}

function sessionValid_(token) {
  if (!token) return false;
  const exp = Number(authProps_().getProperty('S_' + sha256Hex_(String(token)).slice(0, 40)) || 0);
  return exp > Date.now();
}

function endAllSessions_() {
  const props = authProps_();
  Object.keys(props.getProperties()).forEach((k) => { if (k.indexOf('S_') === 0) props.deleteProperty(k); });
}

function signedIn_(remember) {
  return json_({ ok: true, session: newSession_(remember), key: authProps_().getProperty('ADMIN_KEY') || '', email: adminEmail_() });
}

function adminLogin_(data) {
  if (tooManyTries_('login', 5)) return json_({ ok: false, error: 'locked' });
  const props = authProps_();
  const hash = props.getProperty('ADMIN_PASS_HASH');
  if (!hash) return json_({ ok: false, error: 'no_password' });
  if (normEmail_(data.email) !== adminEmail_() ||
      !sameText_(hashPassword_(String(data.password || ''), props.getProperty('ADMIN_PASS_SALT')), hash)) {
    noteFailure_('login');
    return json_({ ok: false, error: 'wrong' });
  }
  CacheService.getScriptCache().remove('fail_login');
  return signedIn_(!!data.remember);
}

function adminForgot_(data) {
  const cache = CacheService.getScriptCache();
  // Same answer whether or not the email matches, so the page can't be used to guess it.
  if (normEmail_(data.email) !== adminEmail_()) return json_({ ok: true });
  if (cache.get('reset_sent')) return json_({ ok: false, error: 'wait' });   // one code a minute
  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('reset_code', sha256Hex_(code), RESET_CODE_SECONDS);
  cache.put('reset_sent', '1', 60);
  cache.remove('fail_reset');
  MailApp.sendEmail({
    to: adminEmail_(),
    subject: `${code} is your FA Vision admin reset code`,
    body: `Your F.A Vision admin password reset code is:\n\n${code}\n\n` +
      `Enter it on the admin sign-in page within 10 minutes to set a new password.\n\n` +
      `If you didn't ask for this, ignore this email; your password hasn't changed.`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:420px">` +
      `<p>Your <b>F.A Vision admin</b> password reset code is:</p>` +
      `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>` +
      `<p>Enter it on the admin sign-in page within <b>10 minutes</b> to set a new password.</p>` +
      `<p style="color:#777;font-size:13px">If you didn't ask for this, ignore this email; your password hasn't changed.</p></div>`,
    name: BUSINESS.name,
  });
  return json_({ ok: true });
}

function adminReset_(data) {
  const cache = CacheService.getScriptCache();
  if (normEmail_(data.email) !== adminEmail_()) return json_({ ok: false, error: 'bad_code' });
  if (tooManyTries_('reset', 5)) { cache.remove('reset_code'); return json_({ ok: false, error: 'locked' }); }
  const want = cache.get('reset_code');
  if (!want) return json_({ ok: false, error: 'expired' });
  if (!sameText_(sha256Hex_(String(data.code || '').replace(/\D/g, '')), want)) {
    noteFailure_('reset');
    return json_({ ok: false, error: 'bad_code' });
  }
  const password = String(data.password || '');
  if (password.length < 8) return json_({ ok: false, error: 'short' });
  const salt = randomToken_().slice(0, 24);
  const props = authProps_();
  props.setProperty('ADMIN_PASS_SALT', salt);
  props.setProperty('ADMIN_PASS_HASH', hashPassword_(password, salt));
  cache.remove('reset_code');
  cache.remove('fail_login');
  endAllSessions_();   // sign out every other device
  return signedIn_(!!data.remember);
}

function adminLogout_(data) {
  if (data.session) authProps_().deleteProperty('S_' + sha256Hex_(String(data.session)).slice(0, 40));
  return json_({ ok: true });
}

// Forwards the admin's GitHub API calls for this one repository, adding the
// token stored here. Only signed-in sessions may use it.
function githubProxy_(data) {
  if (!sessionValid_(data.session)) return json_({ ok: false, error: 'signed_out' });
  const token = authProps_().getProperty('GITHUB_TOKEN');
  if (!token) return json_({ ok: false, error: 'no_github_token' });
  const method = String(data.method || 'GET').toUpperCase();
  const path = String(data.path || '');
  if (['GET', 'POST', 'PATCH'].indexOf(method) < 0 || path.charAt(0) !== '/' || path.indexOf('..') >= 0) {
    return json_({ ok: false, error: 'bad request' });
  }
  const repo = authProps_().getProperty('GITHUB_REPO') || DEFAULT_GITHUB_REPO;
  const opts = {
    method: method.toLowerCase(),
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    muteHttpExceptions: true,
  };
  if (data.body != null) { opts.contentType = 'application/json'; opts.payload = typeof data.body === 'string' ? data.body : JSON.stringify(data.body); }
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + path, opts);
  const text = res.getContentText();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { message: text.slice(0, 300) }; }
  return json_({ ok: true, status: res.getResponseCode(), body: body });
}

// Run once from the editor if you are ever locked out of the admin page and
// the reset email isn't arriving: it signs out every device and clears the
// password, so the next sign-in starts with "Forgot password".
function resetAdminPassword() {
  const props = authProps_();
  props.deleteProperty('ADMIN_PASS_HASH');
  props.deleteProperty('ADMIN_PASS_SALT');
  endAllSessions_();
  Logger.log('Admin password cleared. Use "Forgot password" on the admin page to set a new one.');
}

function listOrders_() {
  const sh = ordersSheet_();
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.Orders.length).getValues();
  return rows.slice(-500).reverse().map((r) => {
    const o = {};
    HEADERS.Orders.forEach((h, i) => { o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
    return o;
  });
}

function updateOrder_(data) {
  if (!checkAdmin_(data.key)) return json_({ ok: false, error: 'not allowed' });
  const ref = String(data.reference || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = ordersSheet_();
    const r = findOrderRow_(sh, ref);
    if (!r) return json_({ ok: false, error: 'order not found' });
    if (data.progress && PROGRESS.indexOf(data.progress) !== -1) sh.getRange(r, ORDER_COL.Progress).setValue(data.progress);
    if (data.progress === 'Balance paid') sh.getRange(r, ORDER_COL.BalanceGHS).setValue(0);
    if (data.note) {
      const cell = sh.getRange(r, ORDER_COL.Notes);
      cell.setValue([cell.getValue(), cleanCell_(data.note)].filter(String).join(' | '));
    }
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

function createSheet_(name) {
  const sh = SpreadsheetApp.getActive().insertSheet(name);
  sh.appendRow(HEADERS[name]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
  return sh;
}

const CATALOG_CACHE_ = {};
// Fetches a data file from the live site once per request.
function siteJson_(url) {
  if (!CATALOG_CACHE_[url]) CATALOG_CACHE_[url] = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  return CATALOG_CACHE_[url];
}

function findProduct_(id) {
  try {
    const url = (PropertiesService.getScriptProperties().getProperty('SITE_URL') || BUSINESS.website).replace(/\/?$/, '/');
    // AI Studio services (/studio/) are priced in data/services.json, one price per option.
    if (/^SVC-/.test(String(id))) {
      const svc = siteJson_(url + 'data/services.json');
      for (const s of svc.services || []) {
        const o = (s.options || []).find((x) => x.id === id);
        if (o) return { id: o.id, name: `${s.name}: ${o.label}`, price_ghs: o.price_ghs };
      }
      return null;
    }
    const list = siteJson_(url + 'data/products.json');
    return (Array.isArray(list) ? list : list.products || []).find((p) => p.id === id) || null;
  } catch (err) {
    return null;
  }
}

// ---------- Invoices ----------
//
// 1. A customer fills in "Request an invoice" on the website -> a row in "Invoices".
// 2. In /admin/ -> Invoices, the owner opens the request, checks the lines and taps
//    "Generate invoice". The admin sends the finished invoice HTML (from
//    assets/js/invoice.js) here; this script numbers it, saves a PDF in Drive,
//    shares it by link, emails it to the customer if asked, and fills in the row.
// Invoice numbers share one sequence: PINV100684 (proforma), INV100685, ...
// following on from FA Vision's paper series (PINV100683). Change the start in
// Project Settings -> Script properties -> INVOICE_SEQ (last number used).

const INVOICE_COL = {};
HEADERS.Invoices.forEach((h, i) => { INVOICE_COL[h] = i + 1; });
const INVOICE_FOLDER = 'FA Vision Invoices';

function invoicesSheet_() {
  return SpreadsheetApp.getActive().getSheetByName(SHEETS.INVOICES) || createSheet_(SHEETS.INVOICES);
}

function recordInvoiceRequest_(data) {
  const id = cleanCell_(data.request_id);
  if (!/^IR-[A-Z0-9]{4,20}$/.test(id)) return json_({ ok: false, error: 'bad request id' });
  const row = [
    new Date(), id, data.kind === 'order' ? 'Invoice for order' : 'Proforma', cleanCell_(data.order_ref),
    cleanCell_(data.name), cleanCell_(data.organisation), cleanCell_(data.phone), cleanCell_(data.email),
    cleanCell_(data.address), cleanCell_(data.tin), cleanCell_(data.po), cleanCell_(data.items),
    'Requested', '', '', '', '', '', '',
  ];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = invoicesSheet_();
    if (!findRow_(sh, INVOICE_COL.RequestId, id)) sh.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  sendSms_(`FA Vision: ${row[2]} request ${id} from ${cleanCell_(data.organisation || data.name)} ${cleanCell_(data.phone)}: ${cleanCell_(data.items)}`);
  const notify = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (notify) {
    MailApp.sendEmail(notify, `Invoice request ${id} from ${cleanCell_(data.organisation || data.name)}`,
      `${row[2]}${data.order_ref ? ' (order ' + cleanCell_(data.order_ref) + ')' : ''}\n` +
      `Name: ${cleanCell_(data.name)}\nOrganisation: ${cleanCell_(data.organisation)}\nPhone: ${cleanCell_(data.phone)}\n` +
      `Email: ${cleanCell_(data.email)}\nAddress: ${cleanCell_(data.address)}\nTIN: ${cleanCell_(data.tin)}  PO: ${cleanCell_(data.po)}\n\n` +
      `Items: ${cleanCell_(data.items)}\n\nCreate it in ${siteUrl_()}admin/#invoices`);
  }
  return json_({ ok: true });
}

function findRow_(sh, col, value) {
  if (!value || sh.getLastRow() < 2) return 0;
  const vals = sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(value)) return i + 2;
  return 0;
}

function listInvoices_() {
  const sh = invoicesSheet_();
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.Invoices.length).getValues();
  return rows.slice(-500).reverse().map((r) => {
    const o = {};
    HEADERS.Invoices.forEach((h, i) => { o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
    return o;
  });
}

function invoiceSeq_() {
  return parseInt(PropertiesService.getScriptProperties().getProperty('INVOICE_SEQ') || '100683', 10);
}

function nextInvoiceNumbers_() {
  const n = invoiceSeq_() + 1;
  return { proforma: 'PINV' + n, invoice: 'INV' + n, tax: 'INV' + n, receipt: 'RCT' + n };
}

function saveInvoice_(data) {
  if (!checkAdmin_(data.key)) return json_({ ok: false, error: 'not allowed' });
  const inv = data.invoice || {};
  const html = String(data.html || '');
  if (!html || html.length > 500000) return json_({ ok: false, error: 'no invoice' });
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let number, url, row;
  try {
    const sh = invoicesSheet_();
    // Keep numbers unique: if the number the admin used is already taken by a
    // different invoice, give this one the next free number.
    number = cleanCell_(inv.number);
    const taken = findRow_(sh, INVOICE_COL.InvoiceNo, number);
    const same = taken && data.request_id && sh.getRange(taken, INVOICE_COL.RequestId).getValue() === data.request_id;
    const digits = parseInt(String(number).replace(/\D/g, ''), 10) || 0;
    if (!number || (taken && !same)) {
      const prefix = String(number).replace(/\d+$/, '') || 'INV';
      number = prefix + (invoiceSeq_() + 1);
    }
    const used = parseInt(number.replace(/\D/g, ''), 10) || digits;
    if (used > invoiceSeq_()) props.setProperty('INVOICE_SEQ', String(used));

    const finalHtml = html.split(cleanCell_(inv.number)).join(number);
    const pdf = Utilities.newBlob(finalHtml, 'text/html', number + '.html').getAs('application/pdf').setName(`${number} - ${cleanCell_(inv.customer_name || 'invoice')}.pdf`);
    const folders = DriveApp.getFoldersByName(INVOICE_FOLDER);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(INVOICE_FOLDER);
    const file = folder.createFile(pdf);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    url = file.getUrl();

    const values = {
      Kind: inv.kind_label, OrderRef: inv.order_ref, Customer: inv.customer_name, Organisation: inv.organisation,
      Phone: inv.phone, Email: inv.email, Address: inv.address, TIN: inv.tin, PO: inv.po, Status: 'Invoice sent',
      InvoiceNo: number, InvoiceDate: inv.issue_date, TotalGHS: Number(inv.total) || 0, BalanceGHS: Number(inv.balance) || 0, PdfUrl: url,
    };
    row = findRow_(sh, INVOICE_COL.RequestId, data.request_id);
    if (!row) {
      sh.appendRow(HEADERS.Invoices.map((h) => (h === 'Timestamp' ? new Date() : h === 'RequestId' ? cleanCell_(data.request_id || 'ADMIN-' + number) : '')));
      row = sh.getLastRow();
    }
    Object.keys(values).forEach((h) => {
      if (values[h] !== undefined && values[h] !== '') sh.getRange(row, INVOICE_COL[h]).setValue(typeof values[h] === 'number' ? values[h] : cleanCell_(values[h]));
    });

    if (data.email_customer && /^\S+@\S+\.\S+$/.test(inv.email || '')) {
      MailApp.sendEmail({
        to: inv.email,
        replyTo: BUSINESS.email,
        name: BUSINESS.name,
        subject: `${inv.kind_label || 'Invoice'} ${number} from ${BUSINESS.name}`,
        htmlBody: `<p>Dear ${cleanCell_(inv.customer_name || 'Customer')},</p><p>Please find attached ${cleanCell_(inv.kind_label || 'invoice').toLowerCase()} <b>${number}</b> ` +
          `for GHS ${Number(inv.total).toFixed(2)}${Number(inv.balance) && Number(inv.balance) !== Number(inv.total) ? ` (balance due GHS ${Number(inv.balance).toFixed(2)})` : ''}.</p>` +
          `<p>You can also view it here: <a href="${url}">${url}</a></p><p>Thank you for choosing ${BUSINESS.name}.<br>${BUSINESS.phones}<br>${BUSINESS.website}</p>`,
        attachments: [pdf],
      });
      sh.getRange(row, INVOICE_COL.Notes).setValue('Emailed ' + new Date().toISOString().slice(0, 10));
    }
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, number, url });
}

// ---------- Batch email campaigns ----------

/**
 * Campaign content. Keep {{name}}, {{organisation}} and {{unsubscribe}}
 * placeholders; they are filled per client.
 */
const CAMPAIGNS = {
  'student-desks-2026': {
    segment: 'Proprietor',
    subject: 'Durable student desks for {{organisation}}: bulk pricing for proprietors',
    html:
      '<p>Dear {{name}},</p>' +
      '<p>As {{organisation}} prepares for the new term, F.A Vision Enterprise in Odorkor, Accra is making ' +
      '<b>student desks</b> built for years of classroom use: hardwood tops on welded steel frames, ' +
      'single and double seater.</p>' +
      '<ul>' +
      '<li><b>Bulk discount</b> for schools ordering 20 desks or more</li>' +
      '<li><b>Delivery and setup</b> in your classrooms across Greater Accra</li>' +
      '<li><b>Repairs</b> and replacement parts when you need them</li>' +
      '</ul>' +
      '<p>Reply to this email with the number of desks you need, ' +
      '<a href="{{whatsapp}}">message us on WhatsApp</a>, or see the desk here: ' +
      '<a href="{{site}}#product/FAV-014">School Desk and Chair Set</a>. We respond the same day.</p>' +
      '<p>Warm regards,<br>F.A Vision Enterprise<br>' + BUSINESS.address + '<br>' +
      'Call ' + BUSINESS.phones + '</p>' +
      '<p style="font-size:12px;color:#777">You are receiving this because your school is listed as a potential ' +
      'customer of F.A Vision Enterprise. <a href="{{unsubscribe}}">Unsubscribe</a>.</p>',
  },
};

/** Sends the campaign to yourself only, so you can check how it looks. */
function previewCampaign() {
  const me = Session.getEffectiveUser().getEmail();
  const c = CAMPAIGNS['student-desks-2026'];
  const vars = { name: 'Proprietor', organisation: 'Your School', unsubscribe: '#', site: siteUrl_(), whatsapp: whatsappUrl_() };
  MailApp.sendEmail({ to: me, subject: '[PREVIEW] ' + fill_(c.subject, vars, true), htmlBody: fill_(c.html, vars) });
}

/**
 * Sends the campaign to clients in the matching segment who have an email,
 * are not unsubscribed, and have not received this campaign yet.
 * Safe to run daily: it stops at the Gmail quota and resumes next run.
 */
function sendCampaign(campaignId) {
  campaignId = campaignId || 'student-desks-2026';
  const c = CAMPAIGNS[campaignId];
  if (!c) throw new Error('Unknown campaign ' + campaignId);

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEETS.CLIENTS);
  const log = ss.getSheetByName(SHEETS.CAMPAIGN_LOG);
  const rows = sh.getDataRange().getValues();
  const col = indexOf_(rows[0]);
  const webApp = ScriptApp.getService().getUrl();
  let quota = MailApp.getRemainingDailyQuota();
  let sent = 0;

  for (let r = 1; r < rows.length && quota > 0; r++) {
    const row = rows[r];
    const email = String(row[col.Email] || '').trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    if (row[col.Status] === 'Unsubscribed') continue;
    if (c.segment && row[col.Segment] !== c.segment) continue;
    if (row[col.LastCampaign] === campaignId) continue;

    let token = row[col.Token];
    if (!token) {
      token = Utilities.getUuid();
      sh.getRange(r + 1, col.Token + 1).setValue(token);
    }
    const vars = {
      name: row[col.Name] || 'Sir/Madam',
      organisation: row[col.Organisation] || 'your school',
      unsubscribe: `${webApp}?action=unsubscribe&token=${token}`,
      site: siteUrl_(),
      whatsapp: whatsappUrl_(),
    };
    try {
      MailApp.sendEmail({ to: email, subject: fill_(c.subject, vars, true), htmlBody: fill_(c.html, vars), name: BUSINESS.name });
      sh.getRange(r + 1, col.LastCampaign + 1, 1, 2).setValues([[campaignId, new Date()]]);
      log.appendRow([new Date(), campaignId, email, 'sent']);
      sent++;
      quota--;
    } catch (err) {
      log.appendRow([new Date(), campaignId, email, 'error: ' + err.message]);
    }
  }
  Logger.log(`Sent ${sent} emails. Remaining quota today: ${MailApp.getRemainingDailyQuota()}`);
  return sent;
}

/** Creates a daily 9am trigger so a large list is worked through automatically. */
function scheduleDailyCampaign() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sendCampaign')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendCampaign').timeBased().everyDays(1).atHour(9).create();
}

function markUnsubscribed_(token) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.CLIENTS);
  const rows = sh.getDataRange().getValues();
  const col = indexOf_(rows[0]);
  for (let r = 1; r < rows.length; r++) {
    if (rows[r][col.Token] === token) {
      sh.getRange(r + 1, col.Status + 1).setValue('Unsubscribed');
      return true;
    }
  }
  return false;
}

function siteUrl_() {
  return PropertiesService.getScriptProperties().getProperty('SITE_URL') || BUSINESS.website;
}

function whatsappUrl_() {
  return 'https://wa.me/' + BUSINESS.whatsapp + '?text=' +
    encodeURIComponent('Hello F.A Vision, I would like a quote for school desks.');
}

function indexOf_(header) {
  const m = {};
  header.forEach((h, i) => { m[h] = i; });
  return m;
}

/** Fills {{placeholders}}. HTML-escapes client values unless plainText (for subjects). */
function fill_(tpl, vars, plainText) {
  return tpl.replace(/{{(\w+)}}/g, (_, k) => {
    const v = String(vars[k] == null ? '' : vars[k]);
    return plainText || k === 'unsubscribe' || k === 'site' || k === 'whatsapp' ? v : v.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  });
}

// ---------- Customers (CRM) ----------
//
// /admin/ -> Customers joins the Enquiries, Orders and Invoices tabs into one
// list of people, matched by phone number (last 9 digits, so 024..., +233 24...
// and 23324... are the same customer). Enquiries can be moved along
// New -> Contacted -> Quoted -> Won / Lost, with a note and a follow-up date.
// WhatsApp taps from the website have no phone number, so they are counted
// separately as "WhatsApp chats opened".

const ENQUIRY_STATUS = ['New', 'Contacted', 'Quoted', 'Won', 'Lost'];

const phoneKey_ = (v) => String(v || '').replace(/\D/g, '').slice(-9);

function rowsOf_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const width = Math.max(sh.getLastColumn(), HEADERS[name].length);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map((h, i) => h || HEADERS[name][i] || 'Col' + (i + 1));
  const first = Math.max(2, sh.getLastRow() - 1999); // newest 2,000 rows are plenty
  return sh.getRange(first, 1, sh.getLastRow() - first + 1, width).getValues().map((r, i) => {
    const o = { _row: first + i };
    head.forEach((h, j) => { o[h] = r[j] instanceof Date ? r[j].toISOString() : r[j]; });
    return o;
  });
}

function listCustomers_() {
  const people = {};
  let anonymousWhatsApp = 0;
  const person = (phone, name, org, email) => {
    const k = phoneKey_(phone) || ('email:' + String(email || '').toLowerCase()) || '';
    if (k === 'email:') return null;
    const p = people[k] || (people[k] = { key: k, name: '', organisation: '', phone: '', email: '', sources: [],
      enquiries: [], orders: [], invoices: [], spentGHS: 0, balanceGHS: 0, last: '' });
    if (name && !p.name) p.name = String(name);
    if (org && !p.organisation) p.organisation = String(org);
    if (phone && !p.phone) p.phone = String(phone);
    if (email && !p.email) p.email = String(email);
    return p;
  };
  const touch = (p, when, source) => {
    if (when && when > p.last) p.last = when;
    if (source && p.sources.indexOf(source) === -1) p.sources.push(source);
  };

  rowsOf_(SHEETS.ENQUIRIES).forEach((e) => {
    if (!e.Phone && !e.Email) { if (e.Source === 'whatsapp') anonymousWhatsApp++; return; }
    const p = person(e.Phone, e.Name, e.Organisation, e.Email);
    if (!p) return;
    p.enquiries.push({ row: e._row, when: e.Timestamp, product: e.Product, quantity: e.Quantity, message: e.Message,
      source: e.Source, status: e.Status || 'New', notes: e.Notes || '', followUp: e.FollowUp || '' });
    touch(p, e.Timestamp, e.Source || 'website');
  });
  rowsOf_(SHEETS.ORDERS).forEach((o) => {
    const p = person(o.Phone, o.Customer, '', o.Email);
    if (!p) return;
    p.orders.push({ ref: o.Reference, when: o.Timestamp, product: o.Product, quantity: o.Quantity, total: o.TotalGHS,
      balance: o.BalanceGHS, progress: o.Progress });
    if (o.Progress !== 'Cancelled') {
      p.spentGHS += Number(o.TotalGHS) || 0;
      p.balanceGHS += Number(o.BalanceGHS) || 0;
    }
    touch(p, o.Timestamp, 'order');
  });
  rowsOf_(SHEETS.INVOICES).forEach((v) => {
    const p = person(v.Phone, v.Customer, v.Organisation, v.Email);
    if (!p) return;
    p.invoices.push({ no: v.InvoiceNo || v.RequestId, kind: v.Kind, when: v.Timestamp, status: v.Status, total: v.TotalGHS, pdf: v.PdfUrl });
    touch(p, v.Timestamp, 'invoice');
  });

  const list = Object.keys(people).map((k) => people[k]);
  list.sort((a, b) => (b.last > a.last ? 1 : b.last < a.last ? -1 : 0));
  return { customers: list.slice(0, 1000), anonymousWhatsApp };
}

function updateEnquiry_(data) {
  if (!checkAdmin_(data.key)) return json_({ ok: false, error: 'not allowed' });
  const row = Number(data.row);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.ENQUIRIES);
    if (!sh || !(row >= 2) || row > sh.getLastRow()) return json_({ ok: false, error: 'enquiry not found' });
    // Older sheets were made before the Notes / FollowUp columns existed.
    if (!sh.getRange(1, 11).getValue()) sh.getRange(1, 11, 1, 2).setValues([['Notes', 'FollowUp']]).setFontWeight('bold');
    if (data.status && ENQUIRY_STATUS.indexOf(data.status) !== -1) sh.getRange(row, 10).setValue(data.status);
    if (data.note) {
      const cell = sh.getRange(row, 11);
      const stamp = Utilities.formatDate(new Date(), 'GMT', 'd MMM');
      cell.setValue([cell.getValue(), stamp + ': ' + cleanCell_(data.note)].filter(String).join(' | '));
    }
    if (data.followUp !== undefined) sh.getRange(row, 12).setValue(/^\d{4}-\d{2}-\d{2}$/.test(data.followUp) ? data.followUp : '');
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}


// ---------- Social autopilot: daily posting report ----------
//
// Sent to REPORT_EMAIL (Script property; default nanaotengdonkor1@gmail.com):
//   - right after the admin's one-button run ends (action "posting_report",
//     with the admin's fresh copy of the logs), and
//   - every night at about 9 pm by sendPostingReport(), from the live site's
//     data files, unless a report already covers everything done that day.
// Body: totals, then every renewal / group post / Instagram post with its time
// and result, warnings, follower growth and a 7-day table. A CSV of every
// action is attached for audit.

const DEFAULT_REPORT_EMAIL = 'nanaotengdonkor1@gmail.com';
function reportEmail_() { return String(authProps_().getProperty('REPORT_EMAIL') || DEFAULT_REPORT_EMAIL).trim(); }

function postingReportNow_(data) {
  if (!sessionValid_(data.session)) return json_({ ok: false, error: 'signed_out' });
  try {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day : Utilities.formatDate(new Date(), 'Africa/Accra', 'yyyy-MM-dd');
    sendPostingReport_(day, data.fb || {}, data.ig || {}, data.products || {});
    return json_({ ok: true, to: reportEmail_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}

// Nightly trigger (created by setup()).
function sendPostingReport() {
  const day = Utilities.formatDate(new Date(), 'Africa/Accra', 'yyyy-MM-dd');
  const site = (authProps_().getProperty('SITE_URL') || BUSINESS.website).replace(/\/?$/, '/');
  const get = (path) => { try { return JSON.parse(UrlFetchApp.fetch(site + path + '?t=' + Date.now(), { muteHttpExceptions: true }).getContentText()); } catch (e) { return {}; } };
  const fb = get('data/facebook-autopilot.json');
  const ig = get('data/instagram-autopilot.json');
  const products = {};
  const list = get('data/products.json');
  (Array.isArray(list) ? list : []).forEach((p) => { products[p.id] = String(p.name).split(' — ')[0]; });
  // Skip if today's report already covers everything done today.
  const last = authProps_().getProperty('LAST_POSTING_REPORT') || '';
  const latest = [].concat(fb.posts || [], fb.runs || [], ig.posts || [], ig.runs || []).filter((x) => x.d === day).map((x) => x.t || '').sort().pop() || '';
  if (last.slice(0, 10) === day && last >= latest) return;
  sendPostingReport_(day, fb, ig, products);
}

function sendPostingReport_(day, fb, ig, products) {
  const r = buildPostingReport_(day, fb, ig, products);
  MailApp.sendEmail({
    to: reportEmail_(),
    subject: r.subject,
    htmlBody: r.html,
    name: BUSINESS.name + ' autopilot',
    attachments: [Utilities.newBlob(r.csv, 'text/csv', 'fa-vision-posting-' + day + '.csv')],
  });
  authProps_().setProperty('LAST_POSTING_REPORT', new Date().toISOString());
}

function buildPostingReport_(day, fb, ig, products) {
  const h = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const time = (t) => (t ? Utilities.formatDate(new Date(t), 'Africa/Accra', 'HH:mm') : '');
  const pname = (id) => products[id] || id || '';
  const groups = {};
  (fb.groups || []).forEach((g) => { groups[g.id] = g; });
  const gname = (id) => (groups[id] && groups[id].name) || id;
  const on = (arr) => (arr || []).filter((x) => x.d === day);
  const renew = on(fb.renewLog);
  const gposts = on(fb.posts);
  const iposts = on(ig.posts);
  const runs = on(fb.runs).concat(on(ig.runs));
  const igLabel = (x) => x.label || (String(x.k || '').indexOf('card:') === 0 ? pname(String(x.k).slice(5)) + ' (deal card)' : String(x.k || '').replace(/^ad:/, 'Ad: '));
  const okN = (a) => a.filter((x) => x.ok).length;
  const pending = gposts.filter((x) => x.ok && /approval/i.test(x.why || '')).length;
  const prof = (ig.profile || []).slice().sort((a, b) => (a.d < b.d ? -1 : 1));
  const pAt = (d) => prof.filter((x) => x.d <= d).pop();
  const shift = (n) => Utilities.formatDate(new Date(new Date(day + 'T12:00:00Z').getTime() - n * 864e5), 'Africa/Accra', 'yyyy-MM-dd');
  const nowP = prof.filter((x) => x.d === day).pop();
  const delta = (n) => { const o = pAt(shift(n)); return nowP && o && nowP.followers != null && o.followers != null ? nowP.followers - o.followers : null; };
  const sgn = (n) => (n == null ? '–' : (n > 0 ? '+' : '') + n);
  const prettyDay = Utilities.formatDate(new Date(day + 'T12:00:00Z'), 'Africa/Accra', 'EEEE d MMMM yyyy');

  const tile = (big, small, warn) => '<td style="padding:12px;border:1px solid #e3e6ec;border-radius:10px;background:' + (warn ? '#fdecec' : '#f7f8fa') + ';width:25%;vertical-align:top"><div style="font:700 22px Arial,sans-serif;color:#14171a">' + big + '</div><div style="font:13px Arial,sans-serif;color:#4f5a64">' + small + '</div></td>';
  const table = (head, rows, empty) => rows.length
    ? '<table cellpadding="6" style="border-collapse:collapse;width:100%;font:13px Arial,sans-serif"><tr>' + head.map((x) => '<th align="left" style="border-bottom:2px solid #e3e6ec;color:#4f5a64">' + x + '</th>').join('') + '</tr>' +
      rows.map((r) => '<tr>' + r.map((c, i) => '<td style="border-bottom:1px solid #eef0f4;' + (i === 2 ? 'white-space:nowrap;' : '') + (i === r.length - 1 && /✗/.test(r[2] || r[1]) ? 'color:#c62828' : '') + '">' + c + '</td>').join('') + '</tr>').join('') + '</table>'
    : '<p style="font:13px Arial,sans-serif;color:#4f5a64">' + empty + '</p>';
  const mark = (x) => (x.ok ? '✓' : '✗');

  const issues = [];
  runs.filter((r) => r.stopped).forEach((r) => issues.push(time(r.t) + ' · ' + ({ renew: 'Marketplace', post: 'Facebook groups', ig: 'Instagram' }[r.kind] || r.kind) + ' stopped: ' + r.stopped));
  gposts.filter((x) => !x.ok).forEach((x) => issues.push(time(x.t) + ' · Group "' + gname(x.g) + '": ' + (x.why || 'failed')));
  iposts.filter((x) => !x.ok).forEach((x) => issues.push(time(x.t) + ' · Instagram "' + igLabel(x) + '": ' + (x.why || 'failed')));
  renew.filter((x) => !x.ok && !/next renewal/i.test(x.why || '')).forEach((x) => issues.push('Renewal "' + x.t + '": ' + (x.why || 'failed')));
  const offGroups = (fb.groups || []).filter((g) => !g.active && g.off_why);

  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = shift(i);
    const p = (ig.profile || []).filter((x) => x.d === d).pop();
    week.push([Utilities.formatDate(new Date(d + 'T12:00:00Z'), 'Africa/Accra', 'EEE d MMM'),
      (fb.renewLog || []).filter((x) => x.d === d && x.ok).length,
      (fb.posts || []).filter((x) => x.d === d && x.ok).length + ' / ' + (fb.posts || []).filter((x) => x.d === d).length,
      (ig.posts || []).filter((x) => x.d === d && x.ok).length + ' / ' + (ig.posts || []).filter((x) => x.d === d).length,
      p && p.followers != null ? p.followers : '–']);
  }

  const total = okN(renew) + okN(gposts) + okN(iposts);
  const html =
    '<div style="max-width:720px;margin:auto;font:14px Arial,sans-serif;color:#14171a">' +
    '<h2 style="margin:0 0 4px">Posting report · ' + h(prettyDay) + '</h2>' +
    '<p style="margin:0 0 16px;color:#4f5a64">' + h(BUSINESS.name) + ' Social autopilot. ' + total + ' successful action' + (total === 1 ? '' : 's') + ' today' + (issues.length ? ', ' + issues.length + ' issue' + (issues.length === 1 ? '' : 's') + ' to check.' : ', no issues.') + '</p>' +
    '<table cellspacing="8" style="width:100%;border-collapse:separate"><tr>' +
    tile(okN(renew), 'Marketplace listings renewed' + (renew.length - okN(renew) ? '<br>' + (renew.length - okN(renew)) + ' not ready yet' : '')) +
    tile(okN(gposts) + ' / ' + gposts.length, 'Facebook group posts' + (pending ? '<br>' + pending + ' awaiting admin approval' : ''), gposts.length && okN(gposts) < gposts.length / 2) +
    tile(okN(iposts) + ' / ' + iposts.length, 'Instagram posts' + (ig.settings ? ' (target ' + ig.settings.daily_posts + ')' : '')) +
    tile(nowP && nowP.followers != null ? nowP.followers : '–', 'Instagram followers<br>' + sgn(delta(1)) + ' today · ' + sgn(delta(7)) + ' this week') +
    '</tr></table>' +
    (issues.length ? '<h3 style="color:#c62828">Issues to check</h3><ul style="font:13px Arial,sans-serif">' + issues.map((x) => '<li>' + h(x) + '</li>').join('') + '</ul>' : '') +
    '<h3>Marketplace renewals</h3>' + table(['#', 'Listing', 'Result', 'Note'], renew.map((x, i) => [i + 1, h(x.t), mark(x) + (x.ok ? ' Renewed' : ' Not renewed'), h(x.why || '')]), 'No renewals ran today.' + (fb.selling ? ' Last check ' + h(fb.selling.d) + ': ' + fb.selling.n + ' listings, ' + fb.selling.due + ' due.' : '')) +
    '<h3>Facebook group posts</h3>' + table(['Time', 'Group', 'Result', 'Listing / note'], gposts.map((x) => [time(x.t), h(gname(x.g)), mark(x) + (x.ok ? ' Posted' : ' Failed'), h(pname(x.p)) + (x.why ? ' · ' + h(x.why) : '')]), 'No group posts today.') +
    '<h3>Instagram posts' + (ig.settings ? ' (@' + h(ig.settings.account) + ')' : '') + '</h3>' + table(['Time', 'Photo', 'Result', 'Note'], iposts.map((x) => [time(x.t), h(igLabel(x)) + (x.spot ? ' ★ spotlight' : ''), mark(x) + (x.ok ? ' Posted' : ' Failed'), h(x.why || '')]), 'No Instagram posts today.') +
    (nowP ? '<p style="font:13px Arial,sans-serif;color:#4f5a64">Profile today: ' + (nowP.followers != null ? nowP.followers + ' followers, ' : '') + (nowP.following != null ? nowP.following + ' following, ' : '') + (nowP.posts != null ? nowP.posts + ' posts. ' : '') + 'Growth: ' + sgn(delta(1)) + ' since yesterday, ' + sgn(delta(7)) + ' in 7 days, ' + sgn(delta(30)) + ' in 30 days.</p>' : '') +
    (offGroups.length ? '<h3>Groups switched off</h3><p style="font:13px Arial,sans-serif;color:#4f5a64">These groups get no posts. A group is switched off by hand, or by itself after 3 failed posts in a row. Turn one back on in the admin (Social autopilot → Facebook).</p><ul style="font:13px Arial,sans-serif">' + offGroups.map((g) => '<li>' + h(g.name) + ': ' + h(g.off_why) + '</li>').join('') + '</ul>' : '') +
    '<h3>Last 7 days</h3>' + table(['Day', 'Renewed', 'Group posts (ok / tried)', 'Instagram (ok / tried)', 'Followers'], week, '') +
    '<p style="font:12px Arial,sans-serif;color:#8a949e;margin-top:20px">Every action is in the attached CSV. Source: data/facebook-autopilot.json and data/instagram-autopilot.json in your website repository. Sent ' + h(Utilities.formatDate(new Date(), 'Africa/Accra', 'd MMM yyyy HH:mm')) + ' (Accra).</p>' +
    '</div>';

  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^[=+\-@]/, "'$&") + '"';
  const rows = [['Date', 'Time', 'Platform', 'Action', 'Item', 'Where', 'Result', 'Note']];
  renew.forEach((x) => rows.push([day, '', 'Facebook Marketplace', 'Renew', x.t, 'Your listings', x.ok ? 'OK' : 'Not renewed', x.why || '']));
  gposts.forEach((x) => rows.push([day, time(x.t), 'Facebook group', 'Post', pname(x.p), gname(x.g), x.ok ? 'OK' : 'Failed', x.why || '']));
  iposts.forEach((x) => rows.push([day, time(x.t), 'Instagram', 'Post', igLabel(x), '@' + ((ig.settings || {}).account || ''), x.ok ? 'OK' : 'Failed', [x.spot ? 'Spotlight' : '', x.why || ''].filter(String).join(' · ')]));
  runs.filter((r) => r.stopped).forEach((r) => rows.push([day, time(r.t), r.kind === 'ig' ? 'Instagram' : 'Facebook', 'Run stopped', '', '', 'Stopped', r.stopped]));
  if (nowP) rows.push([day, '', 'Instagram', 'Profile', 'Followers ' + nowP.followers, 'Following ' + nowP.following, 'Posts ' + nowP.posts, 'Growth today ' + sgn(delta(1))]);
  const csv = rows.map((r) => r.map(q).join(',')).join('\r\n');

  const subject = 'Posting report ' + day + ': ' + okN(renew) + ' renewed, ' + okN(gposts) + ' group posts, ' + okN(iposts) + ' Instagram' + (issues.length ? ' · ' + issues.length + ' issue' + (issues.length === 1 ? '' : 's') : '');
  return { subject: subject, html: html, csv: csv };
}

// Run from the editor to see a sample report in your inbox straight away.
function testPostingReport() {
  authProps_().deleteProperty('LAST_POSTING_REPORT');
  sendPostingReport();
}

// ---------- Posting alerts (Social autopilot) ----------
// The admin calls action "session_alert" just before each posting session starts
// (kind "session"), and once on the day the new-group target is reached (kind "milestone").
// Emailed to REPORT_EMAIL like the posting report.
function sessionAlert_(data) {
  if (!sessionValid_(data.session)) return json_({ ok: false, error: 'signed_out' });
  try {
    const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const day = /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day : Utilities.formatDate(new Date(), 'Africa/Accra', 'yyyy-MM-dd');
    const t = data.totals || {};
    const joins = (data.joins || []).slice(0, 60);
    const removed = (data.removed || []).slice(0, 60);
    const groups = (data.groups || []).slice(0, 60);
    const mb = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n || '?'));
    const milestone = data.kind === 'milestone';
    if (milestone) {
      const k = 'ALERT20_' + day;
      if (authProps_().getProperty(k)) return json_({ ok: true, to: reportEmail_(), already: true });
      authProps_().setProperty(k, '1');
    }
    const subject = milestone
      ? `🎉 ${t.joined_today || joins.length} new Facebook groups added today (${day})`
      : `FA Vision: posting session starting — ${groups.length} group post${groups.length === 1 ? '' : 's'} (${day})`;
    const list = (rows) => rows.length ? '<ul>' + rows.join('') + '</ul>' : '<p style="color:#777">None.</p>';
    const statusText = { joined: 'joined', pending: 'waiting for the group admin', questions: 'answer the group\'s questions on Facebook', failed: 'failed' };
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px">` +
      (milestone
        ? `<h2 style="margin:0 0 8px">🎉 ${h(t.joined_today)} of ${h(t.target)} new groups added today</h2>`
        : `<h2 style="margin:0 0 8px">Posting session starting now</h2><p>Today's listing: <b>${h(data.listing || '—')}</b>, into ${groups.length} group${groups.length === 1 ? '' : 's'}.</p>`) +
      `<p>Groups on the list: <b>${h(t.active)}</b> active · ${h(t.pending || 0)} waiting for admins · ${h(t.removed || 0)} removed for declining our posts. New today: <b>${h(t.joined_today || 0)}/${h(t.target)}</b>.</p>` +
      (milestone ? '' : `<h3>Posting into</h3>${list(groups.map((g) => `<li>${h(g)}</li>`))}`) +
      `<h3>New groups today</h3>${list(joins.map((j) => `<li>${j.url ? `<a href="${h(j.url)}">${h(j.name)}</a>` : h(j.name)} — ${mb(j.members)} members · ${h(statusText[j.status] || j.status)}</li>`))}` +
      `<h3>Removed today (declined our posts)</h3>${list(removed.map((r) => `<li>${h(r.name)} — ${h(r.why)} · ${r.left ? 'left on Facebook' : 'still to leave on Facebook'}</li>`))}` +
      `<p style="color:#777;font-size:12px">Sent by your FA Vision admin (Social autopilot). The full day's report follows when the run ends.</p></div>`;
    MailApp.sendEmail({ to: reportEmail_(), subject, htmlBody: html, body: subject, name: BUSINESS.name });
    return json_({ ok: true, to: reportEmail_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}

// ---------- Muse AI (phone app at /muse/) ----------
// Muse sends { action: "muse", session, mode, messages: [{ role: "user"|"assistant", text }], context }.
// Signed-in sessions only (same email + password as /admin/). The AI key stays here:
//   GEMINI_API_KEY     free key from aistudio.google.com (used if set), model GEMINI_MODEL (default gemini-2.5-flash)
//   ANTHROPIC_API_KEY  Claude key from console.anthropic.com (used when there's no Gemini key),
//                      model CLAUDE_MODEL (default claude-haiku-4-5-20251001)
// Capped at 120 requests an hour.
const MUSE_MODES = {
  content: 'You write social media and marketplace content for F.A Vision Enterprise: captions, ad copy, hashtags, WhatsApp broadcasts, TikTok/Reel scripts and posting plans. Write ready-to-post text in a warm Ghanaian business voice. Always include price, WhatsApp number and the website link when a product is given. Say "we sell", never "we make".',
  assistant: 'You are Muse, a practical personal assistant for Alexander Awuku: business owner (F.A Vision Enterprise and partner businesses) and banking operations professional in Accra. Give clear, direct, action-ready answers. Use tables or steps when they help.',
  code: 'You are Muse in code mode. Write complete, working code the user can copy and run (HTML/CSS/JS, Python, Google Apps Script, Excel/Sheets formulas, Bash). Put each file in one fenced code block with the language, then 1-3 short lines on how to run it. Prefer simple, dependency-free solutions that work on a phone or a basic laptop.',
};
function museAsk_(data) {
  if (!sessionValid_(data.session)) return json_({ ok: false, error: 'signed_out' });
  const cache = CacheService.getScriptCache();
  const slot = 'muse_' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHH');
  const n = Number(cache.get(slot) || 0);
  if (n >= 120) return json_({ ok: false, error: 'busy' });
  cache.put(slot, String(n + 1), 3600);
  const props = authProps_();
  const mode = MUSE_MODES[data.mode] ? data.mode : 'assistant';
  const system = MUSE_MODES[mode] + '\n\nBusiness facts: ' + BUSINESS.name + ', ' + BUSINESS.address + '. Phones ' + BUSINESS.phones +
    '. WhatsApp 057 264 6176. Website ' + BUSINESS.website + '.' + (data.context ? '\n\nContext from the app:\n' + String(data.context).slice(0, 6000) : '');
  const msgs = (Array.isArray(data.messages) ? data.messages : []).slice(-16)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: String(m.text || '').slice(0, 8000) }))
    .filter((m) => m.text);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json_({ ok: false, error: 'empty' });
  try {
    const gem = props.getProperty('GEMINI_API_KEY');
    const claude = props.getProperty('ANTHROPIC_API_KEY');
    let text = '';
    if (gem) {
      const model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
      const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': gem },
        payload: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
          generationConfig: { maxOutputTokens: 4096, temperature: mode === 'code' ? 0.3 : 0.8 },
        }),
      });
      const out = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() >= 300) return json_({ ok: false, error: 'ai: ' + ((out.error && out.error.message) || res.getResponseCode()) });
      text = ((((out.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
    } else if (claude) {
      const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-api-key': claude, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({
          model: props.getProperty('CLAUDE_MODEL') || 'claude-haiku-4-5-20251001', max_tokens: 4096, system,
          messages: msgs.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      const out = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() >= 300) return json_({ ok: false, error: 'ai: ' + ((out.error && out.error.message) || res.getResponseCode()) });
      text = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    } else {
      return json_({ ok: false, error: 'no_ai_key' });
    }
    return json_({ ok: true, text: text || '(no answer)', mode });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}
