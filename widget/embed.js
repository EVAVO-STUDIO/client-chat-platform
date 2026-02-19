/*!
 * Client Chat Widget (no build step required)
 * Usage:
 * <script src="https://HOST/embed.js" data-api-base="https://WORKER_URL" data-bot-id="your-bot" data-title="Support"></script>
 */
(function () {
  const script = document.currentScript;
  if (!script) return;

  const apiBase = script.getAttribute("data-api-base") || "";
  const botId = script.getAttribute("data-bot-id") || "";
  const title = script.getAttribute("data-title") || "Chat";
  const brand = script.getAttribute("data-brand") || "#00e589";

  if (!apiBase || !botId) {
    console.warn("[ChatWidget] Missing data-api-base or data-bot-id");
    return;
  }

  const storageKey = `ccp:${botId}:history`;
  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const style = document.createElement("style");
  style.textContent = `
  .ccp-launcher{position:fixed;right:18px;bottom:18px;z-index:999999;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial}
  .ccp-bubble{width:56px;height:56px;border-radius:999px;background:${brand};box-shadow:0 10px 30px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;transition:transform .2s ease}
  .ccp-bubble:hover{transform:translateY(-1px)}
  .ccp-icon{width:22px;height:22px;fill:white}
  .ccp-panel{position:fixed;right:18px;bottom:86px;width:min(380px,calc(100vw - 36px));height:min(560px,calc(100vh - 120px));background:#0b0f14;border:1px solid rgba(255,255,255,.08);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden;display:none;flex-direction:column;z-index:999999}
  .ccp-panel.open{display:flex}
  .ccp-header{display:flex;align-items:center;justify-content:space-between;padding:14px 14px;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(255,255,255,.08)}
  .ccp-title{color:#fff;font-weight:700;font-size:14px;letter-spacing:.2px}
  .ccp-close{color:rgba(255,255,255,.7);cursor:pointer;border-radius:10px;padding:6px 8px}
  .ccp-close:hover{background:rgba(255,255,255,.06)}
  .ccp-messages{padding:14px;gap:10px;display:flex;flex-direction:column;overflow:auto;flex:1}
  .ccp-msg{max-width:85%;padding:10px 12px;border-radius:14px;line-height:1.35;font-size:13px;white-space:pre-wrap;word-wrap:break-word}
  .ccp-user{align-self:flex-end;background:rgba(255,255,255,.10);color:#fff;border-top-right-radius:6px}
  .ccp-assistant{align-self:flex-start;background:rgba(0,0,0,.30);color:rgba(255,255,255,.92);border-top-left-radius:6px;border:1px solid rgba(255,255,255,.06)}
  .ccp-footer{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02)}
  .ccp-input{flex:1;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.25);color:#fff;padding:10px 10px;font-size:13px;outline:none}
  .ccp-input:focus{border-color:${brand}}
  .ccp-send{border:0;border-radius:12px;background:${brand};color:#08110d;font-weight:800;padding:10px 12px;cursor:pointer}
  .ccp-send:disabled{opacity:.6;cursor:not-allowed}
  .ccp-hint{color:rgba(255,255,255,.55);font-size:11px;padding:0 14px 12px}
  `;
  document.head.appendChild(style);

  function el(tag, cls, text) {
    const x = document.createElement(tag);
    if (cls) x.className = cls;
    if (text != null) x.textContent = text;
    return x;
  }

  const launcher = el("div", "ccp-launcher");
  const bubble = el("div", "ccp-bubble");
  bubble.setAttribute("aria-label", "Open chat");
  bubble.setAttribute("role", "button");

  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 24 24");
  svg.setAttribute("class","ccp-icon");
  svg.innerHTML = '<path d="M12 3c-5.2 0-9 3.4-9 8 0 2.4 1.2 4.5 3.2 6l-.7 3.6c-.1.6.5 1.1 1.1.9l4.1-1.6c.7.1 1.5.2 2.3.2 5.2 0 9-3.4 9-8s-3.8-8-9-8Zm-4 9h8v2H8v-2Zm0-4h8v2H8V8Z"/>';
  bubble.appendChild(svg);

  const panel = el("div", "ccp-panel");
  const header = el("div", "ccp-header");
  const hTitle = el("div", "ccp-title", title);
  const close = el("div", "ccp-close", "✕");
  close.setAttribute("role","button");
  close.setAttribute("aria-label","Close chat");
  header.appendChild(hTitle);
  header.appendChild(close);

  const messages = el("div", "ccp-messages");
  const hint = el("div", "ccp-hint", "This is an AI assistant. For sensitive info, use the contact form.");

  const footer = el("div", "ccp-footer");
  const input = el("input", "ccp-input");
  input.type = "text";
  input.placeholder = "Type your message…";
  input.setAttribute("aria-label","Chat message");

  const send = el("button", "ccp-send", "Send");
  footer.appendChild(input);
  footer.appendChild(send);

  panel.appendChild(header);
  panel.appendChild(messages);
  panel.appendChild(hint);
  panel.appendChild(footer);

  launcher.appendChild(bubble);
  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  function loadHistory() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(arr) {
    try { localStorage.setItem(storageKey, JSON.stringify(arr.slice(-20))); } catch {}
  }

  function renderMessage(role, content) {
    const node = el("div", "ccp-msg " + (role === "user" ? "ccp-user" : "ccp-assistant"));
    node.textContent = content;
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
  }

  function setOpen(v) {
    if (v) panel.classList.add("open");
    else panel.classList.remove("open");
  }

  function toggle() {
    const isOpen = panel.classList.contains("open");
    setOpen(!isOpen);
    if (!isOpen) input.focus();
  }

  bubble.addEventListener("click", toggle);
  close.addEventListener("click", () => setOpen(false));
  bubble.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") toggle(); });

  // hydrate history
  const history = loadHistory();
  history.forEach((m) => renderMessage(m.role, m.content));

  // if no history, show greeting placeholder by sending empty hello to server is costly; so we just show a local greeting if provided
  if (history.length === 0) {
    renderMessage("assistant", "Hi — how can I help today?");
  }

  async function sendMessage() {
    const text = (input.value || "").trim();
    if (!text) return;

    input.value = "";
    renderMessage("user", text);

    const h = loadHistory();
    h.push({ role: "user", content: text });

    send.disabled = true;

    try {
      const res = await fetch(apiBase.replace(/\/$/,"") + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          botId,
          messages: h.slice(-12),
          meta: { pageUrl: location.href, referrer: document.referrer, userAgent: navigator.userAgent },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data && data.error ? data.error : "Request failed";
        renderMessage("assistant", "Sorry — " + msg + ".");
        h.push({ role: "assistant", content: "Sorry — " + msg + "." });
        saveHistory(h);
        return;
      }

      const reply = (data && data.reply) ? String(data.reply) : "Sorry — I didn’t get a response.";
      renderMessage("assistant", reply);
      h.push({ role: "assistant", content: reply });
      saveHistory(h);
    } catch (err) {
      renderMessage("assistant", "Sorry — network error. Please try again.");
      const h2 = loadHistory();
      h2.push({ role: "assistant", content: "Sorry — network error. Please try again." });
      saveHistory(h2);
    } finally {
      send.disabled = false;
    }
  }

  send.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
})();
