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
  context.sendSms_ = () => {};
  return { context, rows, verificationCalls, notifications, cache };
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
    console.error(`FAIL ${name}: ${error.message}`);
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
