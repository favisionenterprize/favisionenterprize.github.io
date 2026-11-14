(() => {
  const A = () => window.FAV_ADMIN;
  const FILE = "data/inbox-automations.json";
  const META_URL = "https://business.facebook.com/latest/inbox/automated_responses?business_id=769785330076321&asset_id=110032960671410";
  const FACTS = "F.A Vision Enterprise. WhatsApp: 020 747 3267. Showroom: Odorkor. Printing press: Omanjor. Service areas include Accra, Tema, and Kasoa. Do not state business hours, exact stock, custom prices, delivery dates, or order status unless the user supplies them.";
  const BUILTINS = [
    { id: "orders", name: "Orders", goal: "Create activity", channels: ["Messenger", "WhatsApp"], guidance: "Acknowledge the order question and ask which product, quantity, and area. Never confirm an order, price, or stock." },
    { id: "leads", name: "Leads", goal: "Create activity", channels: ["Messenger", "WhatsApp"], guidance: "Ask what product the person is interested in and their area. Ask for a preferred contact method only if needed. Never request sensitive information." },
    { id: "welcome", name: "Auto reply", goal: "Greet people", channels: ["Messenger", "Instagram"], guidance: "Greet the person warmly and invite them to share what product they need." },
    { id: "faqs", name: "Frequently asked questions", goal: "Share information", channels: ["Messenger", "Instagram", "WhatsApp"], guidance: "Give a short general answer and invite the person to specify the product. Do not invent facts." },
    { id: "away", name: "Away message", goal: "Greet people", channels: ["Messenger", "Instagram"], guidance: "Acknowledge the message and say the team will reply when available. Do not promise a response time." },
    { id: "contact", name: "Contact information", goal: "Share information", channels: ["Messenger", "Instagram"], guidance: "Share the verified WhatsApp number and invite the person to contact the business." },
    { id: "hours", name: "Hours", goal: "Share information", channels: ["Messenger", "Instagram"], guidance: "Do not invent opening hours. Use a clear [ADD CONFIRMED BUSINESS HOURS] placeholder and invite the person to confirm before publishing." },
    { id: "location", name: "Location", goal: "Share information", channels: ["Messenger", "Instagram"], guidance: "Share the verified Odorkor showroom and Omanjor printing-press locations without inventing street addresses or directions." }
  ];
  const FALLBACK = { version: 1, automations: [] };
  const screen = document.querySelector("#screen-inboxauto");
  if (!screen) return;

  let items = [];
  let loaded = false;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const status = (text, error = false) => {
    const node = $("#inboxauto-status");
    if (!node) return;
    node.textContent = text;
    node.className = error ? "note bad" : "note";
  };

  function normalize(saved) {
    const stored = saved && Array.isArray(saved.automations) ? saved.automations : [];
    const standard = BUILTINS.map(template => {
      const current = stored.find(item => item && item.id === template.id) || {};
      return { ...template, message: typeof current.message === "string" ? current.message : "", metaConfigured: current.metaConfigured === true };
    });
    const custom = stored.filter(item => item && item.custom === true && typeof item.id === "string").map(item => ({
      id: item.id,
      name: String(item.name || "Custom automation").slice(0, 80),
      goal: String(item.goal || "Share information"),
      channels: Array.isArray(item.channels) ? item.channels.filter(channel => ["Messenger", "Instagram", "WhatsApp"].includes(channel)) : ["Messenger"],
      guidance: String(item.guidance || "").slice(0, 500),
      message: typeof item.message === "string" ? item.message : "",
      metaConfigured: item.metaConfigured === true,
      custom: true
    }));
    return standard.concat(custom);
  }

  function render() {
    const list = $("#inboxauto-list");
    if (!list) return;
    list.innerHTML = items.map(item => `
      <article class="card" style="margin:12px 0">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <h2 style="margin:0">${esc(item.name)}</h2>
            <div class="muted">${esc(item.goal)} · ${esc(item.channels.join(", "))}</div>
          </div>
          ${item.custom ? `<button class="btn btn-ghost btn-sm" type="button" data-inbox-delete="${esc(item.id)}">Remove</button>` : ""}
        </div>
        ${item.custom ? `<label class="muted">What should this automation do?<textarea rows="2" maxlength="500" data-inbox-guidance="${esc(item.id)}">${esc(item.guidance)}</textarea></label>` : `<p class="muted">${esc(item.guidance)}</p>`}
        <label>AI message draft<textarea rows="3" maxlength="1000" data-inbox-message="${esc(item.id)}" placeholder="Generate a draft, then review and edit it before copying into Meta.">${esc(item.message)}</textarea></label>
        <div class="row" style="align-items:center">
          <button class="btn btn-ghost" type="button" data-inbox-generate="${esc(item.id)}">✨ Draft with AI</button>
          <button class="btn btn-ghost" type="button" data-inbox-copy="${esc(item.id)}" ${item.message ? "" : "disabled"}>Copy message</button>
          <label class="muted"><input type="checkbox" data-inbox-configured="${esc(item.id)}" ${item.metaConfigured ? "checked" : ""}> I configured this in Meta</label>
        </div>
      </article>`).join("");
  }

  async function load() {
    try {
      const saved = await A().readJsonFile(FILE, FALLBACK);
      items = normalize(saved);
      loaded = true;
      render();
      status("These are setup drafts only. Meta activation must be completed and verified in Business Suite.");
    } catch (error) {
      items = normalize(FALLBACK);
      loaded = true;
      render();
      status("Could not load saved automation setups: " + error.message, true);
    }
  }

  function open() {
    document.querySelectorAll(".screen").forEach(node => { node.hidden = node !== screen; });
    const top = $("#top-actions");
    if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#inboxauto") history.replaceState(null, "", "#inboxauto");
    if (loaded) render();
    else load();
  }

  function promptFor(item) {
    return `Draft one concise, copy-ready message for a Meta Business Suite inbox automation.
Business facts: ${FACTS}
Automation name: ${item.name}
Goal: ${item.goal}
Channels: ${item.channels.join(", ")}
Owner guidance: ${item.guidance}
Rules: do not claim this is active; do not invent facts, hours, prices, stock, delivery promises, discounts, or order status; do not ask for passwords, verification codes, payment details, or other sensitive information. If a necessary fact is unknown, use a short [CONFIRM ...] placeholder. Output only the message text, under 600 characters.`;
  }

  async function generate(id, button) {
    const item = items.find(entry => entry.id === id);
    if (!item) return;
    button.disabled = true;
    status("Drafting a message with FA Vision AI…");
    try {
      const result = await A().backendSigned({
        action: "muse",
        mode: "content",
        messages: [{ role: "user", text: promptFor(item) }]
      });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : "The AI did not return a draft.");
      const draft = String(result.text || "").trim();
      if (!draft) throw new Error("The AI returned an empty draft.");
      item.message = draft.slice(0, 1000);
      render();
      status("Draft ready. Review it, then copy it into Meta; it has not been sent or activated.");
    } catch (error) {
      status("AI draft failed: " + error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function save() {
    status("Saving setup drafts…");
    try {
      const data = {
        version: 1,
        automations: items.map(({ id, name, goal, channels, guidance, message, metaConfigured, custom }) => ({
          id, name, goal, channels, guidance, message, metaConfigured: metaConfigured === true, ...(custom ? { custom: true } : {})
        }))
      };
      const result = await A().saveJson(FILE, () => data, "Inbox automation setups saved", FALLBACK);
      if (result && result.ok === false) throw new Error(result.error || "The setup drafts could not be saved.");
      status("Setup drafts saved. The “configured in Meta” checkbox is your confirmation, not a live connection.");
    } catch (error) {
      status("Save failed: " + error.message, true);
    }
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-inboxauto]")) {
      event.preventDefault();
      open();
      return;
    }
    const generateButton = event.target.closest("[data-inbox-generate]");
    if (generateButton) {
      generate(generateButton.dataset.inboxGenerate, generateButton);
      return;
    }
    const copyButton = event.target.closest("[data-inbox-copy]");
    if (copyButton) {
      const item = items.find(entry => entry.id === copyButton.dataset.inboxCopy);
      if (!item || !item.message) return;
      navigator.clipboard.writeText(item.message)
        .then(() => status("Copied. Paste and enable the automation in Meta Business Suite; nothing was sent."))
        .catch(error => status("Could not copy the message: " + error.message, true));
      return;
    }
    if (event.target.closest("#inboxauto-save")) {
      save();
      return;
    }
    const deleteButton = event.target.closest("[data-inbox-delete]");
    if (deleteButton) {
      items = items.filter(item => item.id !== deleteButton.dataset.inboxDelete);
      render();
      status("Custom setup removed from this draft. Save to persist the change.");
      return;
    }
    if (event.target.closest("#inboxauto-open-meta")) window.open(META_URL, "_blank", "noopener");
  });

  document.addEventListener("input", event => {
    const message = event.target.closest("[data-inbox-message]");
    if (message) {
      const item = items.find(entry => entry.id === message.dataset.inboxMessage);
      if (item) item.message = message.value;
      return;
    }
    const guidance = event.target.closest("[data-inbox-guidance]");
    if (guidance) {
      const item = items.find(entry => entry.id === guidance.dataset.inboxGuidance);
      if (item) item.guidance = guidance.value;
    }
  });

  document.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-inbox-configured]");
    if (!checkbox) return;
    const item = items.find(entry => entry.id === checkbox.dataset.inboxConfigured);
    if (item) {
      item.metaConfigured = checkbox.checked;
      status("Configuration status changed locally. Save to keep this self-reported marker.");
    }
  });

  document.addEventListener("submit", event => {
    if (event.target.id !== "inboxauto-create") return;
    event.preventDefault();
    const form = event.target;
    const name = $("#inboxauto-name", form).value.trim();
    const guidance = $("#inboxauto-guidance", form).value.trim();
    const goal = $("#inboxauto-goal", form).value;
    const channels = [...form.querySelectorAll("[name='inboxauto-channel']:checked")].map(input => input.value);
    if (!name || !guidance || !channels.length) {
      status("Add a name, describe the goal, and select at least one channel.", true);
      return;
    }
    items.push({
      id: "custom-" + Date.now(),
      name: name.slice(0, 80),
      goal,
      channels,
      guidance: guidance.slice(0, 500),
      message: "",
      metaConfigured: false,
      custom: true
    });
    form.reset();
    render();
    status("Custom setup added. Generate and review its draft, then save it.");
  });
})();
