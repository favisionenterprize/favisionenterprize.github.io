"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repo = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repo, "backend", "apps-script", "Code.gs"), "utf8");

function createHarness(options = {}) {
  const rows = [];
  const verificationCalls = [];
  const notifications = [];
  const cache = new Map();
  const scriptProperties = options.scriptProperties || {};
  const products = options.products || {};
  const verify = options.verify || (() => ({ ok: false, configured: true, amount: 0, note: "NOT FOUND" }));
  const sheet = {
    getLastRow: () => rows.length + 1,
    appendRow: row => rows.push(row.slice()),
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues() {
          return rows.slice(row - 2, row - 2 + rowCount).map(values => values.slice(column - 1, column - 1 + columnCount));
        },
        setValues(values) {
          rows[row - 2] = values[0].slice();
        }
      };
    }
  };
  const context = vm.createContext({
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: text => ({ getContent: () => text, setMimeType() { return this; } })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.get(key) || null,
        put: (key, value) => cache.set(key, String(value))
      })
    },
    Utilities: { formatDate: date => date.toISOString().slice(0, 13).replace(/[-T]/g, "") },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => Object.prototype.hasOwnProperty.call(scriptProperties, key)
          ? scriptProperties[key]
          : key === "PAYSTACK_SECRET_KEY" && !options.noPaystackKey ? "test-key" : null
      })
    },
    UrlFetchApp: {
      fetch: options.fetch || (() => { throw new Error("Unexpected network request in local test"); })
    }
  });
  vm.runInContext(source, context, { filename: "backend/apps-script/Code.gs" });
  context.ordersSheet_ = () => sheet;
  if (!options.useRealCatalogue) context.findProduct_ = id => products[id] || null;
  if (!options.useRealSiteJson) context.siteJson_ = () => ({ payments: { deposit_percent: options.depositPercent == null ? 50 : options.depositPercent } });
  if (!options.useRealVerification) {
    context.verifyPaystack_ = (reference, expectedAmount, expectedIdentity) => {
      verificationCalls.push({ reference, expectedAmount, expectedIdentity });
      return verify(reference, expectedAmount, expectedIdentity);
    };
  }
  context.notifyOrder_ = (...args) => notifications.push(args);
  const sendSms = context.sendSms_;
  context.sendSms_ = () => {};
  return { context, rows, verificationCalls, notifications, cache, sendSms };
}

function order(overrides = {}) {
  return Object.assign({
    reference: "FAV-ABC123",
    name: "Test buyer",
    phone: "0241234567",
    product_id: "P-001",
    product: "Dining chair",
    quantity: 1,
    unit_price: 1,
    total: 1,
    amount_due: 1,
    plan: "full",
    plan_label: "Pay in full now",
    method: "card",
    status: "Paid"
  }, overrides);
}

function response(context, data) {
  return JSON.parse(context.recordOrder_(data).getContent());
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

test("unknown catalogue item cannot fall back to a browser price", () => {
  const h = createHarness();
  const result = response(h.context, order({ product_id: "UNKNOWN", unit_price: 1, total: 1, amount_due: 1 }));
  assert.equal(result.ok, false);
  assert.equal(h.rows.length, 0);
});

test("room-design items cannot fall back to browser-supplied prices", () => {
  const h = createHarness();
  const result = response(h.context, order({
    product_id: "ROOM-DESIGN",
    items: [{ id: "UNKNOWN", qty: 1, price_ghs: 0.01 }],
    total: 0.01,
    amount_due: 0.01
  }));
  assert.equal(result.ok, false);
  assert.equal(h.rows.length, 0);
});

test("catalogue service failure rejects the order instead of using client pricing", () => {
  const h = createHarness({
    useRealCatalogue: true,
    useRealSiteJson: true,
    fetch: () => ({ getResponseCode: () => 503, getContentText: () => "unavailable" })
  });
  const result = response(h.context, order({ unit_price: 1, total: 1, amount_due: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "catalogue_unavailable");
  assert.equal(h.rows.length, 0);
});

test("unavailable catalogue products cannot be ordered by bypassing the website", () => {
  const h = createHarness({
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 100, in_stock: false } }
  });
  const result = response(h.context, order({ total: 100, unit_price: 100, amount_due: 100 }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "unavailable_product");
  assert.equal(h.rows.length, 0);
});

test("full payment uses the catalogue total and verifies that exact amount", () => {
  const h = createHarness({
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 100 } },
    verify: (_reference, expectedAmount) => ({
      ok: expectedAmount === 100,
      configured: true,
      amount: expectedAmount === 100 ? 100 : 0,
      note: expectedAmount === 100 ? "VERIFIED by Paystack: GHS 100" : "AMOUNT MISMATCH"
    })
  });
  const result = response(h.context, order({ total: 1, unit_price: 1, amount_due: 1 }));
  assert.equal(result.ok, true);
  assert.equal(h.verificationCalls[0].expectedAmount, 100);
  assert.equal(h.rows[0][7], 100);
  assert.equal(h.rows[0][8], 100);
  assert.equal(h.rows[0][11], 100);
  assert.equal(h.rows[0][14], "Paid");
});

test("underpayment is not recorded as a verified or paid order", () => {
  const h = createHarness({
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 100 } },
    verify: () => ({ ok: false, configured: true, amount: 0, note: "AMOUNT MISMATCH" })
  });
  response(h.context, order({ total: 100, amount_due: 100 }));
  assert.equal(h.rows[0][11], 0);
  assert.notEqual(h.rows[0][14], "Paid");
  assert.match(h.rows[0][15], /MISMATCH/);
});

test("overpayment is held for review instead of being treated as paid", () => {
  const h = createHarness({
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 100 } },
    verify: () => ({ ok: false, configured: true, amount: 0, amountMismatch: true, note: "AMOUNT MISMATCH" })
  });
  response(h.context, order({ total: 100, amount_due: 100 }));
  assert.equal(h.rows[0][11], 0);
  assert.equal(h.rows[0][14], "Payment review required");
});

test("deposit payment is derived from the server configuration", () => {
  const h = createHarness({
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 200 } },
    verify: (_reference, expectedAmount) => ({
      ok: expectedAmount === 100,
      configured: true,
      amount: expectedAmount === 100 ? 100 : 0,
      note: expectedAmount === 100 ? "VERIFIED by Paystack: GHS 100" : "AMOUNT MISMATCH"
    })
  });
  response(h.context, order({ plan: "deposit", plan_label: "Pay 50% deposit now", total: 200, amount_due: 1 }));
  assert.equal(h.verificationCalls[0].expectedAmount, 100);
  assert.equal(h.rows[0][11], 100);
  assert.equal(h.rows[0][12], 100);
  assert.equal(h.rows[0][14], "Deposit paid");
});

test("deposit rounded below one pesewa is rejected without creating an order", () => {
  const h = createHarness({
    depositPercent: 10,
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 0.01 } }
  });
  const result = response(h.context, order({
    plan: "deposit",
    plan_label: "Pay 10% deposit now",
    total: 0.01,
    amount_due: 0
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_payment_amount");
  assert.equal(h.rows.length, 0);
});

test("invalid quantity and plan are rejected before creating an order", () => {
  const h = createHarness({
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 100 } }
  });
  assert.equal(response(h.context, order({ quantity: 0 })).ok, false);
  assert.equal(response(h.context, order({ quantity: 501 })).ok, false);
  assert.equal(response(h.context, order({ plan: "freeform" })).ok, false);
  assert.equal(h.rows.length, 0);
});

test("failed, unavailable, malformed and non-JSON Paystack responses never verify", () => {
  const failed = createHarness({
    useRealVerification: true,
    fetch: () => ({
      getContentText: () => JSON.stringify({
        status: true,
        data: { reference: "FAV-ABC123", status: "failed", currency: "GHS", amount: 10000 }
      })
    })
  });
  assert.equal(failed.context.verifyPaystack_("FAV-ABC123", 100).ok, false);

  const missingKey = createHarness({ useRealVerification: true, noPaystackKey: true });
  assert.equal(missingKey.context.verifyPaystack_("FAV-ABC123", 100).configured, false);

  const unavailable = createHarness({
    useRealVerification: true,
    fetch: () => ({ getResponseCode: () => 503, getContentText: () => "unavailable" })
  });
  assert.equal(unavailable.context.verifyPaystack_("FAV-ABC123", 100).ok, false);

  const malformed = createHarness({
    useRealVerification: true,
    fetch: () => ({ getContentText: () => "not-json" })
  });
  assert.equal(malformed.context.verifyPaystack_("FAV-ABC123", 100).ok, false);
});

test("invalid references are rejected before any sheet write", () => {
  const h = createHarness();
  assert.equal(response(h.context, order({ reference: "not-a-reference" })).ok, false);
  assert.equal(h.rows.length, 0);
  assert.equal(h.verificationCalls.length, 0);
});

test("no-online-payment plans ignore forged paid statuses and amounts", () => {
  const h = createHarness({
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 100 } }
  });
  response(h.context, order({ plan: "delivery", total: 100, amount_due: 100, status: "Paid" }));
  assert.equal(h.verificationCalls.length, 0);
  assert.equal(h.rows[0][11], 0);
  assert.notEqual(h.rows[0][14], "Paid");
});

test("a reused reference cannot be reassigned to a different catalogue item", () => {
  const h = createHarness({
    products: {
      "P-001": { id: "P-001", name: "Dining chair", price_ghs: 100 },
      "P-002": { id: "P-002", name: "Coffee table", price_ghs: 100 }
    },
    verify: (_reference, expectedAmount, identity) => ({
      ok: expectedAmount === 100 && identity.productId === "P-001",
      configured: true,
      amount: expectedAmount === 100 && identity.productId === "P-001" ? 100 : 0,
      note: identity.productId === "P-001" ? "VERIFIED by Paystack: GHS 100" : "ORDER MISMATCH"
    })
  });
  assert.equal(response(h.context, order({ total: 100, unit_price: 100, amount_due: 100 })).ok, true);
  const result = response(h.context, order({
    product_id: "P-002",
    product: "Coffee table",
    total: 100,
    unit_price: 100,
    amount_due: 100
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "reference_conflict");
  assert.match(h.rows[0][5], /P-001/);
});

test("webhook-before-checkout creates a priced order and the later post preserves payment", () => {
  const payload = {
    status: true,
    data: {
      reference: "FAV-ABC123",
      status: "success",
      currency: "GHS",
      amount: 10000,
      channel: "card",
      metadata: {
        custom_fields: [
          { variable_name: "customer", value: "Test buyer" },
          { variable_name: "phone", value: "0241234567" },
          { variable_name: "product_id", value: "P-001" },
          { variable_name: "quantity", value: "1" },
          { variable_name: "items_json", value: "[]" },
          { variable_name: "plan_code", value: "full" },
          { variable_name: "delivery", value: "Accra" }
        ]
      }
    }
  };
  const h = createHarness({
    useRealVerification: true,
    products: { "P-001": { id: "P-001", name: "Dining chair", price_ghs: 100 } },
    fetch: () => ({ getContentText: () => JSON.stringify(payload) })
  });
  assert.equal(h.context.upsertPaystackPayment_("FAV-ABC123"), true);
  assert.equal(h.rows.length, 1);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.rows[0][8], 100);
  assert.equal(h.rows[0][11], 100);
  assert.equal(h.rows[0][14], "Paid");
  h.rows[0][17] = "Confirmed";
  assert.equal(h.context.upsertPaystackPayment_("FAV-ABC123"), false);
  assert.equal(h.notifications.length, 1);
  response(h.context, order({ total: 100, unit_price: 100, amount_due: 100 }));
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0][11], 100);
  assert.equal(h.rows[0][17], "Confirmed");
});

test("Paystack verification checks the expected amount and transaction reference", () => {
  const payload = {
    status: true,
    data: { reference: "FAV-ABC123", status: "success", currency: "GHS", amount: 10000, channel: "card" }
  };
  const h = createHarness({
    useRealVerification: true,
    fetch: () => ({ getContentText: () => JSON.stringify(payload) })
  });
  assert.equal(h.context.verifyPaystack_("FAV-ABC123", 100).ok, true);
  assert.equal(h.context.verifyPaystack_("FAV-ABC123", 99).ok, false);
  assert.equal(h.context.verifyPaystack_("FAV-OTHER1", 100).ok, false);
  payload.data.currency = "USD";
  assert.equal(h.context.verifyPaystack_("FAV-ABC123", 100).ok, false);
  payload.data.currency = "GHS";
  payload.data.metadata = {
    custom_fields: [
      { variable_name: "product_id", value: "P-002" },
      { variable_name: "quantity", value: "1" },
      { variable_name: "items_json", value: "[]" },
      { variable_name: "plan_code", value: "full" }
    ]
  };
  assert.equal(h.context.verifyPaystack_("FAV-ABC123", 100, {
    productId: "P-001", quantity: 1, items: [], plan: "full"
  }).ok, false);
});

test("AI runtime status requires a signed-in session and never returns credentials", () => {
  const h = createHarness({
    scriptProperties: {
      GEMINI_API_KEY: "gemini-secret",
      GEMINI_MODEL: "gemini-test-model",
      ANTHROPIC_API_KEY: "claude-secret",
      PEXELS_API_KEY: "pexels-secret"
    }
  });
  h.context.sessionValid_ = session => session === "valid-session";
  const denied = JSON.parse(h.context.aiStatus_({ session: "invalid" }).getContent());
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "signed_out");
  const status = JSON.parse(h.context.aiStatus_({ session: "valid-session" }).getContent());
  assert.equal(status.ok, true);
  assert.equal(status.primary, "gemini");
  assert.equal(status.providers.gemini.model, "gemini-test-model");
  assert.equal(status.providers.claude.configured, true);
  assert.equal(status.providers.pexels.configured, true);
  assert.equal(status.connectionTested, false);
  for (const secret of ["gemini-secret", "claude-secret", "pexels-secret"]) {
    assert.equal(JSON.stringify(status).includes(secret), false);
  }
});

test("AI runtime status reports missing providers without exposing properties", () => {
  const h = createHarness();
  h.context.sessionValid_ = session => session === "valid-session";
  const status = JSON.parse(h.context.aiStatus_({ session: "valid-session" }).getContent());
  assert.equal(status.primary, "");
  assert.equal(status.providers.gemini.configured, false);
  assert.equal(status.providers.claude.configured, false);
  assert.equal(status.providers.pexels.configured, false);
});

test("Muse requests without a provider key do not consume the hourly allowance", () => {
  const h = createHarness();
  h.context.sessionValid_ = session => session === "valid-session";
  const result = JSON.parse(h.context.museAsk_({
    session: "valid-session",
    mode: "assistant",
    messages: [{ role: "user", text: "Test" }]
  }).getContent());
  assert.equal(result.ok, false);
  assert.equal(result.error, "no_ai_key");
  assert.equal(h.cache.size, 0);
});

test("Muse hourly request limit allows 120 claims and rejects the next", () => {
  const h = createHarness();
  let allowed = 0;
  for (let i = 0; i < 120; i++) if (h.context.claimMuseRequest_()) allowed++;
  assert.equal(allowed, 120);
  assert.equal(h.context.claimMuseRequest_(), false);
});

test("Paystack sync paginates transactions beyond the first 100", () => {
  const references = [];
  const requestedPages = [];
  const h = createHarness({
    fetch: url => {
      const parsed = new URL(url);
      requestedPages.push(Number(parsed.searchParams.get("page")));
      const page = Number(parsed.searchParams.get("page"));
      const data = page === 1
        ? Array.from({ length: 100 }, (_, i) => ({ reference: `FAV-PAGE1${String(i).padStart(3, "0")}` }))
        : Array.from({ length: 5 }, (_, i) => ({ reference: `FAV-PAGE2${String(i).padStart(3, "0")}` }));
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ status: true, data, meta: { pagination: { pageCount: 2 } } })
      };
    }
  });
  h.context.upsertPaystackPayment_ = reference => {
    references.push(reference);
    return true;
  };
  assert.equal(h.context.syncPaystack(), 105);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(references.length, 105);
});

test("Paystack sync reports HTTP and malformed-response failures", () => {
  const httpFailure = createHarness({
    fetch: () => ({ getResponseCode: () => 503, getContentText: () => "unavailable" })
  });
  assert.throws(() => httpFailure.context.syncPaystack(), /Paystack sync failed for page 1: HTTP 503/);

  const malformedResponse = createHarness({
    fetch: () => ({ getResponseCode: () => 200, getContentText: () => "not-json" })
  });
  assert.throws(() => malformedResponse.context.syncPaystack(), /Paystack sync returned invalid JSON for page 1/);
});

test("Paystack sync does not call the API without a secret key", () => {
  let fetchCalls = 0;
  const h = createHarness({ noPaystackKey: true, fetch: () => { fetchCalls++; } });
  assert.equal(h.context.syncPaystack(), 0);
  assert.equal(fetchCalls, 0);
});

test("Paystack sync accepts an empty transaction window", () => {
  const h = createHarness({
    fetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ status: true, data: [], meta: { pagination: { pageCount: 0 } } })
    })
  });
  assert.equal(h.context.syncPaystack(), 0);
});

test("Paystack sync stops explicitly at its page safety limit", () => {
  let fetchCalls = 0;
  const h = createHarness({
    fetch: () => {
      fetchCalls++;
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          status: true,
          data: Array.from({ length: 100 }, (_, i) => ({ reference: `FAV-LIMIT${String(i).padStart(3, "0")}` })),
          meta: { pagination: { pageCount: 101 } }
        })
      };
    }
  });
  h.context.upsertPaystackPayment_ = () => false;
  assert.throws(() => h.context.syncPaystack(), /reached the 100-page safety limit/);
  assert.equal(fetchCalls, 100);
});

test("repeated setup preserves user-owned Summary content and formatting", () => {
  const h = createHarness();
  const headers = vm.runInContext("HEADERS", h.context);
  const summaryValues = new Map([["Z99", "Owner analysis"]]);
  const summaryFormulas = new Map();
  const summaryStyles = new Map([["Z99", "italic"]]);
  let clearCalls = 0;
  const sheets = new Map();
  const makeSheet = name => ({
    _headers: headers[name] || [],
    getLastRow() { return this._headers.length ? 1 : 0; },
    getLastColumn() { return this._headers.length; },
    appendRow() {},
    setFrozenRows() {},
    getRange(...args) {
      const sheet = this;
      const key = typeof args[0] === "string" ? args[0] : args.join(":");
      const values = name === "Summary" ? summaryValues : new Map();
      const formulas = name === "Summary" ? summaryFormulas : new Map();
      return {
        getValues() {
          if (typeof args[0] === "string") return [[...(values.get(key) || [])]];
          if (args[0] === 1 && args[1] === 1) return [sheet._headers.slice(0, args[3])];
          return [];
        },
        setValues(rows) {
          values.set(key, rows);
          if (typeof args[0] === "number" && args[0] === 1 && args[1] === 1) sheet._headers = rows[0].slice();
          return this;
        },
        setValue(value) { values.set(key, value); return this; },
        setFormula(formula) { formulas.set(key, formula); return this; },
        setFontWeight(weight) {
          if (name === "Summary") summaryStyles.set(key, weight);
          return this;
        }
      };
    },
    clear() {
      clearCalls++;
      summaryValues.clear();
      summaryFormulas.clear();
      summaryStyles.clear();
    }
  });
  for (const name of ["Enquiries", "Clients", "Sales", "Expenses", "CampaignLog", "Orders", "Invoices", "Summary"]) {
    sheets.set(name, makeSheet(name));
  }
  h.context.SpreadsheetApp = {
    getActive: () => ({
      getSheetByName: name => sheets.get(name) || null,
      insertSheet: name => {
        const sheet = makeSheet(name);
        sheets.set(name, sheet);
        return sheet;
      }
    })
  };
  const properties = new Map([["NOTIFY_EMAIL", "owner@example.com"], ["ADMIN_KEY", "existing-admin-key"]]);
  h.context.PropertiesService.getScriptProperties = () => ({
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, value)
  });
  h.context.Session = { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) };
  h.context.ScriptApp = {
    getProjectTriggers: () => ["syncPaystack", "sendPostingReport"].map(handler => ({
      getHandlerFunction: () => handler
    }))
  };
  h.context.setup();
  h.context.setup();
  assert.equal(clearCalls, 0);
  assert.equal(summaryValues.get("Z99"), "Owner analysis");
  assert.equal(summaryStyles.get("Z99"), "italic");
  assert.equal(summaryStyles.get("A1:B1"), "bold");
  assert.equal(summaryFormulas.has("A11"), true);
  assert.equal(summaryFormulas.has("D11"), true);
});

test("schema migration appends only trailing headers and preserves existing rows", () => {
  const h = createHarness();
  const headers = vm.runInContext("HEADERS", h.context);
  const properties = new Map([["SCHEMA_VERSION", "0"]]);
  h.context.PropertiesService.getScriptProperties = () => ({
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value))
  });
  const sheets = new Map();
  function makeSheet(name, head = [], rows = []) {
    const values = [head.slice(), ...rows.map(row => row.slice())];
    return {
      values,
      getLastRow() { return values.length && values[0].length ? values.length : 0; },
      getLastColumn() { return values[0] ? values[0].length : 0; },
      getRange(row, column, rowCount, columnCount) {
        return {
          getValues() {
            return Array.from({ length: rowCount }, (_, ri) =>
              Array.from({ length: columnCount }, (_, ci) => ((values[row + ri - 1] || [])[column + ci - 1] || "")));
          },
          setValues(next) {
            next.forEach((newRow, ri) => {
              const target = row + ri - 1;
              while (values.length <= target) values.push([]);
              for (let ci = 0; ci < newRow.length; ci++) values[target][column + ci - 1] = newRow[ci];
            });
            return this;
          },
          setFontWeight() { return this; }
        };
      },
      setFrozenRows() {}
    };
  }
  const legacyRows = [["2026-01-01", "Buyer", "", "0240000000", "", "Desk", 1, "Call", "website", "New"]];
  for (const [name, expected] of Object.entries(headers)) {
    const existing = name === "Enquiries" ? expected.slice(0, 10) : expected.slice();
    sheets.set(name, makeSheet(name, existing, name === "Enquiries" ? legacyRows : []));
  }
  h.context.migrateSheets_({
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => { const created = makeSheet(name); sheets.set(name, created); return created; }
  });
  assert.deepEqual(sheets.get("Enquiries").values[0], headers.Enquiries);
  assert.deepEqual(sheets.get("Enquiries").values[1], legacyRows[0]);
  assert.equal(properties.get("SCHEMA_VERSION"), "2");
  assert.deepEqual(sheets.get("CampaignRecipients").values[0], headers.CampaignRecipients);
  assert.deepEqual(sheets.get("BalancePayments").values[0], headers.BalancePayments);
});

test("schema migration refuses reordered columns instead of shifting live data", () => {
  const h = createHarness();
  const headers = vm.runInContext("HEADERS", h.context);
  const properties = new Map([["SCHEMA_VERSION", "1"]]);
  h.context.PropertiesService.getScriptProperties = () => ({
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value))
  });
  const sheets = new Map(Object.entries(headers).map(([name, head]) => [name, {
    getLastRow: () => 1,
    getLastColumn: () => head.length,
    getRange: () => ({ getValues: () => [head], setValues() { return this; }, setFontWeight() { return this; } }),
    setFrozenRows() {}
  }]));
  const orders = sheets.get("Orders");
  const wrongHeader = headers.Orders.slice();
  [wrongHeader[0], wrongHeader[1]] = [wrongHeader[1], wrongHeader[0]];
  orders.getRange = () => ({ getValues: () => [wrongHeader], setValues() { return this; }, setFontWeight() { return this; } });
  assert.throws(() => h.context.migrateSheets_({
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => { const created = sheets.get(name); return created; }
  }), /Cannot migrate Orders: column 1/);
  assert.equal(properties.get("SCHEMA_VERSION"), "1");
});

test("schema migration refuses unknown trailing columns without advancing its version", () => {
  const h = createHarness();
  const headers = vm.runInContext("HEADERS", h.context);
  const properties = new Map([["SCHEMA_VERSION", "1"]]);
  h.context.PropertiesService.getScriptProperties = () => ({
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value))
  });
  let writes = 0;
  const sheets = new Map(Object.entries(headers).map(([name, head]) => [name, {
    getLastRow: () => 1,
    getLastColumn: () => head.length,
    getRange: () => ({
      getValues: () => [head],
      setValues() { writes++; return this; },
      setFontWeight() { return this; }
    }),
    setFrozenRows() {}
  }]));
  const campaignLog = sheets.get("CampaignLog");
  campaignLog.getLastColumn = () => headers.CampaignLog.length + 1;
  campaignLog.getRange = () => ({
    getValues: () => [[...headers.CampaignLog, "OwnerNotes"]],
    setValues() { writes++; return this; },
    setFontWeight() { return this; }
  });
  assert.throws(() => h.context.migrateSheets_({
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => sheets.get(name)
  }), /unexpected column after "Result": "OwnerNotes"; no data was moved/);
  assert.equal(writes, 0);
  assert.equal(properties.get("SCHEMA_VERSION"), "1");
});

test("GitHub proxy routes are restricted to admin data and known workflows", () => {
  const h = createHarness();
  const allowedTree = { base_tree: "a".repeat(40), tree: [
    { path: "data/products.json", mode: "100644", type: "blob", content: "{}" },
    { path: "assets/images/products/photo.jpg", mode: "100644", type: "blob", sha: "b".repeat(40) }
  ] };
  assert.equal(h.context.githubProxyAllowed_("GET", "/contents/data/products.json?ref=" + "a".repeat(40), null), true);
  assert.equal(h.context.githubProxyAllowed_("GET", "/issues", null), false);
  assert.equal(h.context.githubProxyAllowed_("GET", "/contents/.github/workflows/deploy.yml?ref=main", null), false);
  assert.equal(h.context.githubProxyAllowed_("POST", "/git/trees", allowedTree), true);
  assert.equal(h.context.githubProxyAllowed_("POST", "/git/trees", {
    ...allowedTree, tree: [{ path: "assets/images/../../.github/workflows/x.yml", mode: "100644", type: "blob", content: "" }]
  }), false);
  assert.equal(h.context.githubProxyAllowed_("PATCH", "/git/refs/heads/main", { sha: "c".repeat(40), force: true }), false);
  assert.equal(h.context.githubProxyAllowed_("POST", "/actions/workflows/arbitrary.yml/dispatches", { ref: "main" }), false);
  assert.equal(h.context.githubProxyAllowed_("POST", "/actions/workflows/seo-watch.yml/dispatches", { ref: "main" }), true);
});

test("admin sign-in responses no longer disclose the legacy admin key", () => {
  const h = createHarness();
  h.context.newSession_ = () => "session-token";
  h.context.adminEmail_ = () => "owner@example.com";
  const signedIn = JSON.parse(h.context.signedIn_(true).getContent());
  assert.deepEqual(signedIn, { ok: true, session: "session-token", email: "owner@example.com" });
});

test("admin-created leads require a session while public enquiries still work", () => {
  const h = createHarness();
  const enquiries = [];
  h.context.sessionValid_ = session => session === "valid-session";
  h.context.SpreadsheetApp = { getActive: () => ({
    getSheetByName: () => ({ appendRow: row => enquiries.push(row) })
  }) };
  const post = data => JSON.parse(h.context.handlePost_({ postData: { contents: JSON.stringify(data) } }).getContent());
  assert.equal(post({ action: "create_enquiry", name: "Admin lead" }).error, "signed_out");
  assert.equal(enquiries.length, 0);
  assert.equal(post({ action: "create_enquiry", session: "valid-session", name: "Admin lead" }).ok, true);
  assert.equal(post({ name: "Public enquiry" }).ok, true);
  assert.deepEqual(enquiries.map(row => row[1]), ["Admin lead", "Public enquiry"]);
});

test("invoice retries reuse the same row, invoice number and Drive PDF", () => {
  const h = createHarness();
  const headers = Array.from(vm.runInContext("HEADERS.Invoices", h.context));
  const rows = [headers];
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: row => rows.push(row.slice()),
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, ri) =>
          Array.from({ length: columnCount }, (_, ci) => (rows[row + ri - 1] || [])[column + ci - 1] || "")),
        getValue: () => (rows[row - 1] || [])[column - 1] || "",
        setValue: value => {
          while (rows.length < row) rows.push([]);
          rows[row - 1][column - 1] = value;
        },
        setValues: values => values.forEach((value, ri) => {
          while (rows.length < row + ri) rows.push([]);
          value.forEach((cell, ci) => { rows[row + ri - 1][column + ci - 1] = cell; });
        })
      };
    }
  };
  const properties = new Map([["INVOICE_SEQ", "100683"]]);
  h.context.PropertiesService.getScriptProperties = () => ({
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value))
  });
  h.context.SpreadsheetApp = { getActive: () => ({
    getSheetByName: () => sheet,
    insertSheet: () => sheet
  }) };
  h.context.sessionValid_ = session => session === "valid-session";
  h.context.sha256Hex_ = text => String(text.length) + ":" + text;
  const files = new Map();
  let created = 0;
  h.context.DriveApp = {
    Access: { ANYONE_WITH_LINK: "anyone" },
    Permission: { VIEW: "view" },
    getFileById: id => files.get(id),
    getFoldersByName: () => ({ hasNext: () => false }),
    createFolder: () => ({ createFile: () => {
      const id = "pdf-" + (++created);
      const file = { getId: () => id, getUrl: () => "https://drive.example/" + id, setSharing() {} };
      files.set(id, file);
      return file;
    } })
  };
  h.context.Utilities.newBlob = () => ({
    getAs: () => ({ setName(name) { this.name = name; return this; } })
  });
  const payload = {
    session: "valid-session", html: "<html>INV100684</html>",
    invoice: { number: "INV100684", kind_label: "Invoice", customer_name: "Customer", total: 100, balance: 100 }
  };
  const first = JSON.parse(h.context.saveInvoice_(payload).getContent());
  const retry = JSON.parse(h.context.saveInvoice_(payload).getContent());
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(retry.number, first.number);
  assert.equal(retry.url, first.url);
  assert.equal(created, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][headers.indexOf("RequestId")], "ADMIN-INV100684");
  assert.equal(rows[1][headers.indexOf("PdfFileId")], "pdf-1");
});

test("campaign ledger imports legacy sent markers and prevents duplicate claims", () => {
  const h = createHarness();
  const headers = Array.from(vm.runInContext("HEADERS.CampaignRecipients", h.context));
  const rows = [headers];
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: row => rows.push(row.slice()),
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, ri) =>
          Array.from({ length: columnCount }, (_, ci) => (rows[row + ri - 1] || [])[column + ci - 1] || "")),
        getValue: () => (rows[row - 1] || [])[column - 1] || "",
        setValues: values => values.forEach((value, ri) => {
          while (rows.length < row + ri) rows.push([]);
          value.forEach((cell, ci) => { rows[row + ri - 1][column + ci - 1] = cell; });
        })
      };
    }
  };
  h.context.SpreadsheetApp = { getActive: () => ({
    getSheetByName: name => name === "CampaignRecipients" ? sheet : null,
    insertSheet: () => sheet
  }) };
  const legacySentAt = new Date(Date.now() - 86400000);
  assert.equal(h.context.claimCampaignRecipient_("campaign", "Buyer@Example.com", legacySentAt), 0);
  assert.equal(rows[1][2], "sent");
  assert.equal(rows[1][1], "buyer@example.com");
  assert.equal(h.context.claimCampaignRecipient_("campaign", "buyer@example.com", ""), 0);
  const retryRow = h.context.claimCampaignRecipient_("campaign", "retry@example.com", "");
  assert.equal(retryRow, 3);
  assert.equal(h.context.claimCampaignRecipient_("campaign", "retry@example.com", ""), 0);
  h.context.completeCampaignRecipient_(retryRow, "error", "mail failed");
  assert.equal(h.context.claimCampaignRecipient_("campaign", "retry@example.com", ""), retryRow);
});

test("milestone email failure clears the claim so a retry can send", () => {
  const h = createHarness();
  const properties = new Map();
  let sends = 0;
  h.context.sessionValid_ = session => session === "valid-session";
  h.context.authProps_ = () => ({
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value)),
    deleteProperty: key => properties.delete(key)
  });
  h.context.reportEmail_ = () => "owner@example.com";
  h.context.randomToken_ = () => "claim-token";
  h.context.MailApp = { sendEmail: () => {
    sends++;
    if (sends === 1) throw new Error("mail service unavailable");
  } };
  const alert = () => JSON.parse(h.context.sessionAlert_({
    session: "valid-session", kind: "milestone", day: "2026-11-01",
    totals: { joined_today: 20, target: 20 }, joins: [], removed: [], groups: []
  }).getContent());
  assert.equal(alert().ok, false);
  assert.equal(properties.has("ALERT20_2026-11-01"), false);
  assert.equal(alert().ok, true);
  assert.equal(properties.get("ALERT20_2026-11-01"), "sent");
  assert.equal(alert().already, true);
  assert.equal(sends, 2);
});

test("posting report records its activity cursor only after email succeeds", () => {
  const h = createHarness();
  const properties = new Map();
  h.context.authProps_ = () => ({
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value))
  });
  h.context.reportEmail_ = () => "owner@example.com";
  h.context.buildPostingReport_ = () => ({ subject: "Report", html: "<p>report</p>", csv: "date,actions" });
  h.context.latestPostingActivity_ = () => "2026-11-01T10:00:00Z";
  h.context.Utilities.newBlob = () => ({});
  h.context.MailApp = { sendEmail: () => { throw new Error("mail failed"); } };
  assert.throws(() => h.context.sendPostingReport_("2026-11-01", {}, {}, {}), /mail failed/);
  assert.equal(properties.has("POSTING_REPORT_THROUGH"), false);
  assert.equal(properties.has("LAST_POSTING_REPORT"), false);
  h.context.MailApp.sendEmail = () => {};
  h.context.sendPostingReport_("2026-11-01", {}, {}, {});
  assert.equal(properties.get("POSTING_REPORT_THROUGH"), "2026-11-01T10:00:00Z");
  assert.ok(properties.get("LAST_POSTING_REPORT"));
});

test("Seek redirects are limited to approved image hosts", () => {
  const h = createHarness();
  assert.equal(h.context.seekImageUrl_("https://images.pexels.com/photo.jpg"), true);
  assert.equal(h.context.seekImageUrl_("https://images.pexels.com.evil.example/photo.jpg"), false);
  assert.equal(h.context.seekImageUrl_("http://images.pexels.com/photo.jpg"), false);
  assert.equal(h.context.seekImageUrl_("https://images.pexels.com:444/photo.jpg"), false);
  assert.equal(h.context.seekRedirect_("https://images.pexels.com/a.jpg", "//evil.example/a.jpg"), "https://evil.example/a.jpg");
  let fetches = 0;
  h.context.sessionValid_ = session => session === "valid-session";
  h.context.seekBudget_ = () => true;
  h.context.UrlFetchApp = { fetch: () => {
    fetches++;
    return { getResponseCode: () => 302, getHeaders: () => ({ Location: "https://evil.example/a.jpg" }) };
  } };
  const result = JSON.parse(h.context.seekFetch_({
    session: "valid-session", url: "https://images.pexels.com/photo.jpg"
  }).getContent());
  assert.deepEqual(result, { ok: false, error: "bad_redirect" });
  assert.equal(fetches, 1);
});

test("balance settlement records exact amount, method, reference and actor once", () => {
  const h = createHarness();
  const orderHeaders = Array.from(vm.runInContext("HEADERS.Orders", h.context));
  const paymentHeaders = Array.from(vm.runInContext("HEADERS.BalancePayments", h.context));
  const orderRow = Array(orderHeaders.length).fill("");
  orderRow[orderHeaders.indexOf("Reference")] = "FAV-ABC123";
  orderRow[orderHeaders.indexOf("BalanceGHS")] = 75;
  orderRow[orderHeaders.indexOf("Progress")] = "Confirmed";
  const orders = [orderHeaders, orderRow];
  const payments = [paymentHeaders];
  const makeSheet = rows => ({
    getLastRow: () => rows.length,
    appendRow: row => rows.push(row.slice()),
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, ri) =>
          Array.from({ length: columnCount }, (_, ci) => (rows[row + ri - 1] || [])[column + ci - 1] || "")),
        getValue: () => (rows[row - 1] || [])[column - 1] || "",
        setValue: value => { rows[row - 1][column - 1] = value; },
        setValues: values => values.forEach((value, ri) => value.forEach((cell, ci) => { rows[row + ri - 1][column + ci - 1] = cell; }))
      };
    }
  });
  const orderSheet = makeSheet(orders), paymentSheet = makeSheet(payments);
  h.context.ordersSheet_ = () => orderSheet;
  h.context.SpreadsheetApp = { getActive: () => ({
    getSheetByName: name => name === "BalancePayments" ? paymentSheet : null
  }) };
  h.context.sessionValid_ = session => session === "valid-session";
  h.context.adminEmail_ = () => "owner@example.com";
  const data = { action: "update_order", session: "valid-session", reference: "FAV-ABC123",
    progress: "Balance paid", paid_amount: 75, payment_method: "Mobile Money", payment_reference: "MOMO-123" };
  const result = () => JSON.parse(h.context.updateOrder_(data).getContent());
  assert.equal(result().ok, true);
  assert.equal(orders[1][orderHeaders.indexOf("BalanceGHS")], 0);
  assert.equal(orders[1][orderHeaders.indexOf("Progress")], "Balance paid");
  assert.equal(payments.length, 2);
  assert.equal(payments[1][1], "FAV-ABC123");
  assert.equal(payments[1][2], 75);
  assert.equal(payments[1][3], "Mobile Money");
  assert.equal(payments[1][4], "MOMO-123");
  assert.equal(payments[1][5], "owner@example.com");
  assert.equal(result().error, "balance_payment_details_required");
  assert.equal(payments.length, 2);
  assert.equal(JSON.parse(h.context.updateOrder_({ ...data, session: "invalid" }).getContent()).error, "signed_out");
});

test("CRM separates booked, verified paid, unverified and outstanding amounts", () => {
  const h = createHarness();
  const names = vm.runInContext("SHEETS", h.context);
  const tables = {
    [names.BALANCE_PAYMENTS]: [{ Reference: "A", AmountGHS: 20 }],
    [names.ENQUIRIES]: [],
    [names.ORDERS]: [
      { Reference: "A", Phone: "0241234567", Customer: "Customer", TotalGHS: 100, PaidNowGHS: 50, BalanceGHS: 30, Verification: "VERIFIED by Paystack: ref", Progress: "Confirmed" },
      { Reference: "B", Phone: "0241234567", TotalGHS: 50, PaidNowGHS: 20, BalanceGHS: 30, Verification: "manual review", Progress: "Confirmed" },
      { Reference: "C", Phone: "0241234567", TotalGHS: 999, PaidNowGHS: 999, BalanceGHS: 0, Verification: "VERIFIED by Paystack: ref", Progress: "Cancelled" }
    ],
    [names.INVOICES]: []
  };
  h.context.rowsOf_ = name => tables[name] || [];
  const customer = h.context.listCustomers_().customers[0];
  assert.equal(customer.bookedGHS, 150);
  assert.equal(customer.spentGHS, 70);
  assert.equal(customer.paidGHS, 70);
  assert.equal(customer.unverifiedGHS, 20);
  assert.equal(customer.balanceGHS, 60);
});

test("SMS failures release the hourly attempt reservation", () => {
  const h = createHarness();
  const properties = {
    SMS_API_KEY: "test-key", SMS_TO: "0207473267",
    getProperty(key) { return this[key] || null; }
  };
  h.context.PropertiesService.getScriptProperties = () => properties;
  h.context.UrlFetchApp.fetch = () => ({ getResponseCode: () => 503 });
  h.sendSms("Test only");
  const attempts = [...h.cache.entries()].find(([key]) => key.startsWith("sms_") && key.endsWith("_attempts"));
  const successes = [...h.cache.entries()].find(([key]) => key.startsWith("sms_") && key.endsWith("_success"));
  assert.equal(attempts[1], "0");
  assert.equal(successes, undefined);
});

test("SMS success records an accepted send and its quota attempt", () => {
  const h = createHarness();
  const properties = {
    SMS_API_KEY: "test-key", SMS_TO: "0207473267",
    getProperty(key) { return this[key] || null; }
  };
  h.context.PropertiesService.getScriptProperties = () => properties;
  h.context.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200 });
  h.sendSms("Test only");
  assert.equal([...h.cache.entries()].find(([key]) => key.endsWith("_attempts"))[1], "1");
  assert.equal([...h.cache.entries()].find(([key]) => key.endsWith("_success"))[1], "1");
});
