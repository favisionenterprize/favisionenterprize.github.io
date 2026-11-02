// Checkout: order a piece and choose how to pay.
//
// Payment options
//   Pay in full now       Mobile Money (MTN MoMo, Telecel Cash, AT Money) or Visa / Mastercard
//   Pay a deposit now     deposit_percent (default 50%) now, balance on delivery / pickup
//   Pay on delivery       nothing now; cash or MoMo when the piece is delivered
//   Walk in & pay         reserve online, pay at one of our showrooms
//
// Configure in data/business.json -> "payments":
//   paystack_public_key  pk_live_… (or pk_test_… while testing). Turns on online
//                        MoMo + card payments through Paystack's secure popup.
//   momo_number / momo_name / momo_network
//                        Your MoMo merchant or wallet number. Used as a manual
//                        "send to this number" option when Paystack isn't set up.
//   deposit_percent      Deposit for the "pay a deposit" option (default 50).
// Pay on delivery and walk-in always work. Pay-now options appear once
// Paystack or a MoMo number is configured.
window.FAV_CHECKOUT = (function () {
  const C = window.FAV_CONFIG;
  const { business } = window.FAV_DATA;
  const pay = business.payments || {};
  const esc = C.escapeHtml;
  const PAYSTACK_KEY = (pay.paystack_public_key || "").trim();
  const MOMO_NUMBER = (pay.momo_number || "").trim();
  const NETWORK = pay.momo_network || "MTN";
  const DEPOSIT = Math.min(90, Math.max(10, Number(pay.deposit_percent) || 50));
  // A pk_test_ key only runs for you on the private test link (?paytest=1), so real
  // customers never land in Paystack's test mode. A pk_live_ key runs for everyone.
  const TESTING = (() => {
    try {
      if (/[?&]paytest=1\b/.test(location.search)) sessionStorage.setItem("fav-paytest", "1");
      if (/[?&]paytest=0\b/.test(location.search)) sessionStorage.removeItem("fav-paytest");
      return sessionStorage.getItem("fav-paytest") === "1";
    } catch (e) { return /[?&]paytest=1\b/.test(location.search); }
  })();
  const testKey = /^pk_test_/.test(PAYSTACK_KEY);
  const online = /^pk_live_/.test(PAYSTACK_KEY) || (testKey && TESTING);
  const manual = !online && !!MOMO_NUMBER;
  // GhanaPay (GhIPSS bank wallet, *707#). GhanaPay can send to other networks, so
  // customers can pay our MoMo number until we add a GhanaPay wallet number or a
  // GhQR merchant ID in data/business.json -> payments.
  const GHANAPAY_NUMBER = (pay.ghanapay_number || "").trim();
  const GHQR_ID = (pay.ghqr_merchant_id || "").trim();
  const ghanapay = !!(GHQR_ID || GHANAPAY_NUMBER || MOMO_NUMBER);
  const payNow = online || manual || ghanapay;
  const WA = business.whatsapp.replace(/\D/g, "");
  const waLink = msg => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;

  const PLANS = {
    full: { label: "Pay in full now", sub: "MoMo, GhanaPay or card", now: 1 },
    deposit: { label: `Pay ${DEPOSIT}% deposit now`, sub: "Balance on delivery or pickup", now: DEPOSIT / 100 },
    delivery: { label: "Pay on delivery", sub: "Cash or MoMo when it arrives", now: 0 },
    walkin: { label: "Walk in & pay at showroom", sub: "Reserve now, pay at our showroom", now: 0 }
  };
  // AI Studio services (/studio/) reuse this checkout with product.service = true.
  // Their plans read "pay when it's ready" instead of "on delivery", and a
  // product can limit its plans (instant digital guides are pay-first only).
  const SERVICE_PLANS = {
    deposit: { sub: "Balance when your work is ready" },
    delivery: { label: "Pay when it's ready", sub: "Cash or MoMo when we deliver your work" },
    walkin: { label: "Pay at our showroom", sub: "Odorkor, Omanjor or Kasoa" }
  };
  const planInfo = id => Object.assign({}, PLANS[id], product && product.service ? SERVICE_PLANS[id] : null);

  const METHODS = {
    momo: { label: "Mobile Money", sub: "MTN MoMo · Telecel Cash · AT Money", channels: ["mobile_money"] },
    card: { label: "Visa / Mastercard", sub: "Debit or credit card", channels: ["card"] },
    ghanapay: { label: "GhanaPay", sub: "From your GhanaPay wallet · *707#", channels: [] }
  };

  const ICON = {
    momo: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4M9.5 8.5h5M9.5 11.5h3"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/></svg>',
    ghanapay: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M16 13.5h2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };

  // One pickup option per location in data/business.json (Odorkor, Omanjor, Kasoa).
  const SHOWROOMS = (business.locations || []).length
    ? business.locations.map(l => `Pick up at showroom (${l.area})`)
    : ["Pick up at showroom (Odorkor)"];

  // Accepted-payment badges, reused on the product page and the Visit section.
  function badges() {
    const list = online
      ? ["MTN MoMo", "Telecel Cash", "AT Money", "GhanaPay", "Visa", "Mastercard", "Cash on delivery"]
      : manual ? [NETWORK + " MoMo", "GhanaPay", "Cash on delivery", "Pay at showroom"]
        : ["Cash or MoMo on delivery", "Pay at showroom"];
    return `<div class="pay-badges" aria-label="Ways to pay">${list.map(b => `<span class="pay-badge" data-b="${esc(b)}">${esc(b)}</span>`).join("")}</div>`;
  }

  let dlg, product, ref;
  const $ = s => dlg.querySelector(s);

  function newRef() {
    return "FAV-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "co";
    dlg.id = "co";
    dlg.setAttribute("aria-labelledby", "co-title");
    dlg.innerHTML = `<button class="pd-close" type="button" data-close aria-label="Close">×</button><div class="co-body" id="co-body"></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", e => {
      if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
    });
  }

  const areas = () => product.service
    ? ["Send it to me on WhatsApp / email", ...SHOWROOMS]
    : [...SHOWROOMS, ...(business.service_areas || []), "Other (tell us on WhatsApp)"];
  const pickup = area => /showroom/i.test(area);
  const pesewaRound = n => Math.round(n * 100) / 100;

  function renderForm() {
    ref = newRef();
    const img = (product.images || [])[0];
    const plans = Object.keys(PLANS)
      .filter(id => payNow || (id !== "full" && id !== "deposit"))
      .filter(id => !product.plans || product.plans.includes(id))
      .map(id => [id, planInfo(id)]);
    $("#co-body").innerHTML = `
      <p class="kicker">Checkout</p>
      <h2 id="co-title">Place your order</h2>
      <div class="co-item">
        <div class="co-thumb">${img ? `<img src="${esc(img)}" alt="">` : C.iconSvg(product.iconPath || C.categoryIcon(product), 30)}</div>
        <div class="co-item-info">
          <strong>${esc(product.name)}</strong>
          <span>${product.items ? `${product.items.reduce((n, i) => n + i.qty, 0)} items · ${C.formatPrice(product.price_ghs)}` : `${C.formatPrice(product.price_ghs)} ${esc(product.per ? "per " + product.per : "each")} · Ref ${esc(product.id)}`}</span>
        </div>
        ${product.items ? `<input id="co-qty" type="hidden" value="1">` : `<div class="qty" role="group" aria-label="Quantity">
          <button type="button" data-qty="-1" aria-label="Fewer">−</button>
          <input id="co-qty" type="number" min="1" max="500" value="1" inputmode="numeric" aria-label="Quantity">
          <button type="button" data-qty="1" aria-label="More">+</button>
        </div>`}
      </div>
      ${product.items ? `<ul class="co-items">${product.items.map(i => `<li><span>${esc(i.name)}${i.colour ? ` <small>${esc(i.colour)}</small>` : ""} × ${i.qty}</span><b>${C.formatPrice(i.price_ghs * i.qty)}</b></li>`).join("")}</ul>` : ""}
      <form id="co-form" class="co-form" novalidate>
        <div class="co-row">
          <label>Full name<input name="name" required autocomplete="name"></label>
          <label>Phone / MoMo number<input name="phone" required inputmode="tel" autocomplete="tel" placeholder="024 123 4567"></label>
        </div>
        <label>Email <small>(optional, for your receipt)</small><input name="email" type="email" autocomplete="email"></label>
        <label>${product.service ? "How should we get it to you?" : "Delivery or pickup"}
          <select name="area" id="co-area" required>${areas().map(a => `<option>${esc(a)}</option>`).join("")}</select>
        </label>
        <fieldset class="options plans">
          <legend>How would you like to pay?</legend>
          ${plans.map(([id, p], i) => `
            <label class="option">
              <input type="radio" name="plan" value="${id}" ${i === 0 ? "checked" : ""}>
              <span class="option-txt"><strong>${esc(p.label)}</strong><small>${esc(p.sub)}</small></span>
            </label>`).join("")}
        </fieldset>
        <fieldset class="options methods" id="co-methods" ${payNow ? "" : "hidden"}>
          <legend>Pay with</legend>
          ${Object.entries(METHODS).filter(([id]) => id !== "ghanapay" || ghanapay).map(([id, m], i) => {
            const off = id === "card" && !online;
            return `<label class="option${off ? " off" : ""}">
              <input type="radio" name="method" value="${id}" ${i === 0 ? "checked" : ""} ${off ? "disabled" : ""}>
              <span class="option-ico">${ICON[id]}</span>
              <span class="option-txt"><strong>${m.label}</strong><small>${off ? "Coming soon" : (id === "momo" && manual ? `Send to our ${esc(NETWORK)} MoMo number` : m.sub)}</small></span>
            </label>`;
          }).join("")}
        </fieldset>
        <div class="co-total">
          <div class="co-lines" id="co-lines"></div>
          <p class="co-note">${product.service ? esc(product.note || "We'll confirm the details with you on WhatsApp.") : "Delivery fee, if any, depends on your location and is agreed on WhatsApp."}</p>
        </div>
        <p class="co-error" id="co-error" role="alert" hidden></p>
        <button class="btn btn-gold co-pay" type="submit" id="co-pay"></button>
        <p class="co-secure" id="co-secure"></p>
      </form>`;

    const form = $("#co-form");
    const qtyEl = $("#co-qty");
    const update = () => {
      const q = Math.max(1, Math.min(500, parseInt(qtyEl.value, 10) || 1));
      const plan = form.plan.value;
      const tot = product.price_ghs * q;
      const now = pesewaRound(tot * PLANS[plan].now);
      const later = pesewaRound(tot - now);
      $("#co-methods").hidden = !payNow || now === 0;
      if (plan === "walkin" && !SHOWROOMS.includes($("#co-area").value)) $("#co-area").value = SHOWROOMS[0];
      const laterLabel = plan === "walkin" || pickup($("#co-area").value) ? "Pay at showroom" : (product.service ? "Pay when it's ready" : "Pay on delivery");
      $("#co-lines").innerHTML =
        `<div><span>Order total</span><span>${C.formatPrice(tot)}</span></div>` +
        (now && later ? `<div class="muted"><span>${laterLabel}</span><span>${C.formatPrice(later)}</span></div>` : "") +
        `<div class="due"><span>${now ? "Pay now" : laterLabel}</span><strong>${C.formatPrice(now || tot)}</strong></div>`;
      $("#co-pay").textContent = now ? "Pay " + C.formatPrice(now) : "Place order";
      $("#co-secure").innerHTML = now
        ? `${ICON.lock} ${form.method && form.method.value === "ghanapay" ? "You'll get our GhanaPay payment details and a reference on the next step." : online ? (testKey ? "<b>TEST MODE</b>: no real money moves. Use Paystack's test card or test MoMo number." : "Processed securely by Paystack. We never see your card details or MoMo PIN.") : "You'll get our MoMo number and a payment reference on the next step."}`
        : `${ICON.lock} Nothing to pay now. We'll call to confirm your order.`;
      return q;
    };
    const qtyBox = dlg.querySelector(".co-item .qty");
    if (qtyBox) qtyBox.addEventListener("click", e => {
      const b = e.target.closest("[data-qty]");
      if (!b) return;
      qtyEl.value = Math.max(1, (parseInt(qtyEl.value, 10) || 1) + Number(b.dataset.qty));
      update();
    });
    qtyEl.addEventListener("input", update);
    qtyEl.addEventListener("blur", () => { qtyEl.value = update(); });
    const mark = () => form.querySelectorAll(".option").forEach(o => o.classList.toggle("on", o.querySelector("input").checked));
    form.addEventListener("change", () => { mark(); update(); });
    form.addEventListener("submit", e => { e.preventDefault(); submit(form, update()); });
    update();
    mark();
  }

  function showError(msg) {
    const el = $("#co-error");
    el.textContent = msg;
    el.hidden = !msg;
  }

  const validPhone = v => /^(0\d{9}|233\d{9})$/.test(v.replace(/\D/g, ""));

  function submit(form, qty) {
    const d = Object.fromEntries(new FormData(form));
    if (!d.name.trim()) return showError("Please enter your name.");
    if (!validPhone(d.phone)) return showError("Please enter a valid Ghana phone number, e.g. 024 123 4567.");
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return showError("That email doesn't look right. Leave it blank if you don't have one.");
    showError("");
    const tot = product.price_ghs * qty;
    const now = pesewaRound(tot * PLANS[d.plan].now);
    const order = {
      reference: ref,
      name: d.name.trim(),
      phone: d.phone.trim(),
      email: d.email.trim(),
      area: d.area,
      plan: d.plan,
      plan_label: planInfo(d.plan).label,
      method: now ? d.method : "",
      product_id: product.id,
      product: product.name,
      quantity: qty,
      unit_price: product.price_ghs,
      items: product.items ? product.items.map(i => ({ id: i.id, qty: i.qty, colour: i.colour || "", price_ghs: i.price_ghs })) : undefined,
      total: tot,
      amount_due: now,
      balance: pesewaRound(tot - now)
    };
    if (!now) return placeOrder(order);
    if (order.method === "ghanapay") ghanaPay(order);
    else if (online) payOnline(order);
    else manualMomo(order);
  }

  function showroomName(area) {
    const loc = (business.locations || []).find(l => area === `Pick up at showroom (${l.area})`) || (business.locations || [])[0];
    if (!loc) return "Odorkor showroom on Tarazzo Road";
    return `${loc.area} showroom` + (loc.address && !loc.address.startsWith(loc.area) ? ` on ${loc.address}` : "");
  }

  // ---------- Pay on delivery / walk in ----------
  function placeOrder(order) {
    order.status = order.plan === "walkin" ? "Reserved, pay at showroom" : (product.service ? "Pay on completion" : "Pay on delivery");
    record(order);
    renderDone(order, {
      kicker: "Order placed",
      lead: product.service
        ? `We'll call or WhatsApp you on ${esc(order.phone)} to start. You pay ${C.formatPrice(order.total)} ${order.plan === "walkin" ? `at our ${esc(showroomName(order.area))}` : "when your work is ready"}.`
        : order.plan === "walkin"
        ? `Your ${esc(order.product)} is reserved. Visit our ${esc(showroomName(order.area))} (Mon to Sat, 8am to 6pm) and pay ${C.formatPrice(order.total)} by cash, MoMo or card.`
        : `We'll call you on ${esc(order.phone)} to confirm and arrange delivery. Pay ${C.formatPrice(order.total)} by cash or MoMo when it arrives.`,
      wa: "I've just placed an order on your website."
    });
  }

  // ---------- Paystack (MoMo + Visa/Mastercard) ----------
  let paystackLoading;
  function loadPaystack() {
    if (window.PaystackPop) return Promise.resolve();
    paystackLoading = paystackLoading || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.paystack.co/v2/inline.js";
      s.onload = resolve;
      s.onerror = () => { paystackLoading = null; reject(new Error("load")); };
      document.head.appendChild(s);
    });
    return paystackLoading;
  }

  function resetPay(order, msg) {
    if (!dlg.open) dlg.showModal();
    const b = $("#co-pay");
    if (b) { b.disabled = false; b.textContent = "Pay " + C.formatPrice(order.amount_due); }
    showError(msg);
  }

  async function payOnline(order) {
    const btn = $("#co-pay");
    btn.disabled = true;
    btn.textContent = "Opening secure payment…";
    try {
      await loadPaystack();
    } catch (err) {
      return resetPay(order, "Couldn't reach the payment service. Check your internet connection and try again.");
    }
    // Paystack needs an email; customers without one get a placeholder receipt address.
    const email = order.email || `${order.phone.replace(/\D/g, "")}@customers.favisionenterprize.github.io`;
    dlg.close(); // Paystack's popup sits on top; ours would trap focus.
    new window.PaystackPop().newTransaction({
      key: PAYSTACK_KEY,
      email,
      amount: Math.round(order.amount_due * 100), // pesewas
      currency: "GHS",
      reference: order.reference,
      channels: METHODS[order.method].channels,
      metadata: {
        custom_fields: [
          { display_name: "Customer", variable_name: "customer", value: order.name },
          { display_name: "Phone", variable_name: "phone", value: order.phone },
          { display_name: "Product", variable_name: "product", value: `${order.product} (${order.product_id}) × ${order.quantity}` },
          { display_name: "Payment", variable_name: "plan", value: order.plan_label },
          { display_name: "Product ID", variable_name: "product_id", value: String(order.product_id || "") },
          { display_name: "Quantity", variable_name: "quantity", value: String(order.quantity || "") },
          { display_name: "Order items", variable_name: "items_json", value: JSON.stringify((order.items || []).map(i => ({ id: i.id, qty: i.qty, colour: i.colour || "" }))) },
          { display_name: "Payment plan code", variable_name: "plan_code", value: String(order.plan || "") },
          { display_name: "Balance", variable_name: "balance", value: C.formatPrice(order.balance) },
          { display_name: "Delivery", variable_name: "delivery", value: order.area }
        ]
      },
      onSuccess: () => {
        order.status = (testKey ? "TEST " : "") + (order.balance ? "Deposit paid" : "Paid");
        record(order);
        dlg.showModal();
        renderDone(order, {
          kicker: "Payment received",
          lead: `We've received ${C.formatPrice(order.amount_due)} for your ${esc(order.product)}.` + (product.service
            ? (order.balance ? ` The balance of ${C.formatPrice(order.balance)} is paid when your work is ready.` : "") +
              ` We'll WhatsApp you on ${esc(order.phone)} to get started.`
            : (order.balance ? ` The balance of ${C.formatPrice(order.balance)} is paid on ${pickup(order.area) ? "pickup" : "delivery"}.` : "") +
              ` We'll call you on ${esc(order.phone)} to arrange ${pickup(order.area) ? "pickup" : "delivery"}.`),
          wa: "I've just paid on your website."
        });
      },
      onCancel: () => resetPay(order, "Payment was cancelled. You can try again, choose pay on delivery, or order on WhatsApp."),
      onError: err => resetPay(order, "Payment couldn't start: " + ((err && err.message) || "please try again."))
    });
  }

  // ---------- Manual MoMo (no Paystack account yet) ----------
  function manualMomo(order) {
    order.status = "Awaiting MoMo confirmation";
    record(order);
    const dial = { MTN: "*170#", Telecel: "*110#", AT: "*110#" }[NETWORK] || "your MoMo menu";
    $("#co-body").innerHTML = `
      <p class="kicker">Mobile Money</p>
      <h2 id="co-title">Send ${C.formatPrice(order.amount_due)}</h2>
      <div class="momo-card">
        <div><span>${esc(NETWORK)} MoMo number</span><strong class="copyable" data-copy="${esc(MOMO_NUMBER)}">${esc(C.localPhone(MOMO_NUMBER))}</strong></div>
        ${pay.momo_name ? `<div><span>Account name</span><strong>${esc(pay.momo_name)}</strong></div>` : ""}
        <div><span>Amount</span><strong>${C.formatPrice(order.amount_due)}</strong></div>
        <div><span>Reference</span><strong class="copyable" data-copy="${esc(order.reference)}">${esc(order.reference)}</strong></div>
      </div>
      ${order.balance ? `<p class="co-note">Balance of ${C.formatPrice(order.balance)} is paid ${product.service ? "when your work is ready" : "on delivery or pickup"}.</p>` : ""}
      <ol class="momo-steps">
        <li>Dial <b>${esc(dial)}</b> (or open your MoMo app) and choose <b>Transfer money</b>.</li>
        <li>Send <b>${C.formatPrice(order.amount_due)}</b> to <b>${esc(C.localPhone(MOMO_NUMBER))}</b>${pay.momo_name ? ` (${esc(pay.momo_name)})` : ""}.</li>
        <li>Use <b>${esc(order.reference)}</b> as the reference, then confirm with your PIN.</li>
        <li>Tap below to send us your confirmation on WhatsApp.</li>
      </ol>
      <a class="btn btn-wa co-pay" target="_blank" rel="noopener" href="${waLink(receiptText(order, "I've sent the MoMo payment for my order."))}">I've paid · confirm on WhatsApp</a>
      <p class="co-secure">${ICON.lock} Never share your MoMo PIN with anyone, including us.</p>`;
    bindCopy();
  }

  // ---------- GhanaPay ----------
  function ghanaPay(order) {
    order.status = "Awaiting GhanaPay confirmation";
    record(order);
    const to = GHQR_ID
      ? { label: "GhQR merchant ID", value: GHQR_ID, step: `choose <b>Pay merchant (GhQR)</b> and enter merchant ID <b>${esc(GHQR_ID)}</b>, or scan our GhQR code at the showroom` }
      : GHANAPAY_NUMBER
        ? { label: "GhanaPay wallet", value: GHANAPAY_NUMBER, step: `choose <b>Send money → GhanaPay</b> and send to <b>${esc(C.localPhone(GHANAPAY_NUMBER))}</b>` }
        : { label: `${NETWORK} MoMo number`, value: MOMO_NUMBER, step: `choose <b>Send money → Other networks → ${esc(NETWORK)} Mobile Money</b> and send to <b>${esc(C.localPhone(MOMO_NUMBER))}</b>` };
    $("#co-body").innerHTML = `
      <p class="kicker">GhanaPay</p>
      <h2 id="co-title">Send ${C.formatPrice(order.amount_due)}</h2>
      <div class="momo-card">
        <div><span>${esc(to.label)}</span><strong class="copyable" data-copy="${esc(to.value)}">${esc(GHQR_ID ? to.value : C.localPhone(to.value))}</strong></div>
        ${GHQR_ID ? "" : GHANAPAY_NUMBER ? (pay.ghanapay_name ? `<div><span>Account name</span><strong>${esc(pay.ghanapay_name)}</strong></div>` : "") : (pay.momo_name ? `<div><span>Account name</span><strong>${esc(pay.momo_name)}</strong></div>` : "")}
        <div><span>Amount</span><strong>${C.formatPrice(order.amount_due)}</strong></div>
        <div><span>Reference</span><strong class="copyable" data-copy="${esc(order.reference)}">${esc(order.reference)}</strong></div>
      </div>
      ${order.balance ? `<p class="co-note">Balance of ${C.formatPrice(order.balance)} is paid ${product.service ? "when your work is ready" : "on delivery or pickup"}.</p>` : ""}
      <ol class="momo-steps">
        <li>Dial <b>*707#</b> or open the <b>GhanaPay app</b>.</li>
        <li>Then ${to.step}.</li>
        <li>Enter <b>${C.formatPrice(order.amount_due)}</b>, use <b>${esc(order.reference)}</b> as the reference, and confirm with your PIN.</li>
        <li>Tap below to send us your confirmation on WhatsApp.</li>
      </ol>
      <a class="btn btn-wa co-pay" target="_blank" rel="noopener" href="${waLink(receiptText(order, "I've sent the GhanaPay payment for my order."))}">I've paid · confirm on WhatsApp</a>
      <p class="co-secure">${ICON.lock} GhanaPay transfers are free apart from the e-levy. Never share your PIN with anyone, including us.</p>`;
    bindCopy();
  }

  function receiptText(order, lead) {
    return `Hello F.A Vision, ${lead}\n` +
      `Reference: ${order.reference}\n` +
      `Item: ${order.product} (${order.product_id}) × ${order.quantity}\n` +
      `Order total: ${C.formatPrice(order.total)}\n` +
      `Payment: ${order.plan_label}` +
      (order.amount_due ? ` · ${C.formatPrice(order.amount_due)} via ${METHODS[order.method].label}` : "") +
      (order.amount_due && order.balance ? `\nBalance: ${C.formatPrice(order.balance)}` : "") +
      `\nName: ${order.name}\nPhone: ${order.phone}\nDelivery: ${order.area}` +
      (product.brief ? `\n\nBrief:\n${product.brief}` : "") +
      (product.service && product.after ? `\n\n${product.after}` : "");
  }

  function renderDone(order, o) {
    $("#co-body").innerHTML = `
      <div class="co-done">
        <span class="co-tick" aria-hidden="true">✓</span>
        <p class="kicker">${o.kicker}</p>
        <h2 id="co-title">Thank you, ${esc(order.name.split(" ")[0])}!</h2>
        <p class="section-sub">${o.lead}</p>
      </div>
      <dl class="specs">
        <dt>Reference</dt><dd class="copyable" data-copy="${esc(order.reference)}">${esc(order.reference)}</dd>
        <dt>Item</dt><dd>${esc(order.product)} × ${order.quantity}</dd>
        <dt>Order total</dt><dd>${C.formatPrice(order.total)}</dd>
        <dt>Payment</dt><dd>${esc(order.plan_label)}${order.amount_due ? ` · ${METHODS[order.method].label}` : ""}</dd>
        ${order.amount_due && order.balance ? `<dt>Balance</dt><dd>${C.formatPrice(order.balance)}</dd>` : ""}
        <dt>Delivery</dt><dd>${esc(order.area)}</dd>
      </dl>
      <a class="btn btn-wa co-pay" target="_blank" rel="noopener" href="${waLink(receiptText(order, o.wa))}">Send order details on WhatsApp</a>
      ${product.service ? "" : `<a class="btn btn-outline co-pay" href="#invoice" data-invoice-kind="order" data-invoice-ref="${esc(order.reference)}"
        data-invoice-for="${esc(`${order.product} (${order.product_id}) × ${order.quantity}`)}" data-invoice-name="${esc(order.name)}"
        data-invoice-phone="${esc(order.phone)}" data-invoice-email="${esc(order.email || "")}">Request an invoice for this order</a>`}
      <p class="co-secure">Keep your reference. It's how we find your order.</p>`;
    bindCopy();
  }

  function bindCopy() {
    dlg.querySelectorAll(".copyable").forEach(el => {
      el.title = "Tap to copy";
      el.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(el.dataset.copy); el.classList.add("copied"); setTimeout(() => el.classList.remove("copied"), 1500); } catch (e) { /* ignore */ }
      });
    });
  }

  // Log the order in the backend Sheet (backend/README.md), which also verifies
  // Paystack payments with the secret key. text/plain + no-cors for Apps Script.
  function record(order) {
    if (product && product.onRecord) { try { product.onRecord(order); } catch (e) { /* never block the order */ } }
    if (!business.enquiry_endpoint) return;
    fetch(business.enquiry_endpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action: "order", source: "website" }, order))
    }).catch(() => {});
  }

  const canBuy = p => !!p && !p.seller && !!p.price_ghs && !!p.in_stock;   // partner products are paid to the partner

  function open(p) {
    if (!canBuy(p)) return;
    product = p;
    if (!dlg) build();
    renderForm();
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }

  return { open, canBuy, badges, online, payNow };
})();
