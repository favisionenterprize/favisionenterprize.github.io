(() => {
  const screen = document.querySelector("#screen-agent");
  if (!screen) return;

  const skills = [
    { id: "customer-reply", name: "Customer reply draft", prompt: "Draft a warm, concise reply to a general product enquiry. Ask which product and area. Do not invent prices, stock, delivery times, or order status. Do not send the reply." },
    { id: "content-ideas", name: "Content ideas", prompt: "Suggest three practical social content ideas for F.A Vision Enterprise aimed at customers in Ghana. Use only the verified business facts below. Avoid unsupported claims. Do not publish anything." },
    { id: "business-brief", name: "Business brief", prompt: "Turn the business question below into a concise brief with known facts, unknowns to confirm, and three safe next steps. Do not create or change records." }
  ];
  const facts = "Verified business facts: F.A Vision Enterprise. WhatsApp: 020 747 3267. Showroom: Odorkor. Printing press: Omanjor. Service areas include Accra, Tema, and Kasoa. Do not invent business hours, product prices, stock, delivery dates, or order status.";
  const $ = selector => screen.querySelector(selector);
  const form = $("#agent-form");
  const input = $("#agent-prompt");
  const output = $("#agent-output");
  const run = $("#agent-run");
  const skillsNode = $("#agent-skills");
  const status = text => { output.textContent = text; };

  function open() {
    document.querySelectorAll(".screen").forEach(node => { node.hidden = node !== screen; });
    const top = document.querySelector("#top-actions");
    if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#agent") history.replaceState(null, "", "#agent");
  }

  skillsNode.innerHTML = skills.map(skill => `<button class="btn btn-ghost btn-sm" type="button" data-agent-skill="${skill.id}">${skill.name}</button>`).join("");

  document.addEventListener("click", event => {
    if (event.target.closest("[data-agent]")) {
      event.preventDefault();
      open();
      return;
    }
    const skillButton = event.target.closest("[data-agent-skill]");
    if (skillButton && screen.contains(skillButton)) {
      const skill = skills.find(item => item.id === skillButton.dataset.agentSkill);
      if (skill) {
        input.value = `${skill.prompt}\n\nBusiness question or context (do not include customer or sensitive information):`;
        input.focus();
        status("Skill prompt loaded. Review it and add only non-sensitive context before running.");
      }
      return;
    }
    if (event.target.closest("#agent-clear")) {
      input.value = "";
      status("");
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!prompt) {
      status("Enter a prompt before running the assistant.");
      return;
    }
    run.disabled = true;
    status("Asking FA Vision AI…");
    try {
      const result = await window.FAV_ADMIN.backendSigned({
        action: "muse",
        mode: "assistant",
        messages: [{ role: "user", text: `${facts}\n\n${prompt.slice(0, 3000)}\n\nReturn a draft or advice only. Do not claim to have sent messages, changed settings, or performed actions.` }]
      });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : "The AI did not return a response.");
      const answer = String(result.text || "").trim();
      if (!answer) throw new Error("The AI returned an empty response.");
      status(answer.slice(0, 6000));
    } catch (error) {
      status("AI request failed: " + error.message);
    } finally {
      run.disabled = false;
    }
  });
})();
