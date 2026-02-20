// widget/embed.js
// Lightweight embeddable widget for the Client Chat Platform.
// Usage (on client site):
//   <script src="https://YOUR_WORKER_DOMAIN/widget/embed.js" data-bot="digital-safegrid" data-title="Assistant"></script>

(() => {
  const CURRENT_SCRIPT = document.currentScript;
  const BOT_ID = (CURRENT_SCRIPT?.getAttribute("data-bot") || "default").trim();
  const TITLE = (CURRENT_SCRIPT?.getAttribute("data-title") || "Chat").trim();
  const CONTACT_URL = (CURRENT_SCRIPT?.getAttribute("data-contact") || "").trim();

  // Base is the origin where this script is served (worker domain).
  const BASE = new URL(CURRENT_SCRIPT?.src || window.location.href).origin;

  const css = `
  .ccp-launcher{position:fixed;right:16px;bottom:16px;z-index:99999;width:52px;height:52px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:#0a0a0a;color:#fff;box-shadow:0 18px 45px rgba(0,0,0,.35);cursor:pointer}
  .ccp-panel{position:fixed;right:16px;bottom:76px;z-index:99999;width:360px;max-width:calc(100vw - 32px);max-height:min(70vh,560px);display:none;flex-direction:column;overflow:hidden;border-radius:18px;border:1px solid rgba(255,255,255,.12);background:#0b0b0b;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.45)}
  .ccp-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.10)}
  .ccp-title{font:600 13px/1.2 ui-sans-serif,system-ui;opacity:.95}
  .ccp-close{border:1px solid rgba(255,255,255,.14);background:transparent;color:#fff;border-radius:10px;width:32px;height:32px;cursor:pointer}
  .ccp-body{padding:10px 12px;overflow:auto;flex:1;display:flex;flex-direction:column;gap:10px}
  .ccp-row{display:flex}
  .ccp-bubble{max-width:85%;padding:10px 12px;border-radius:16px;border:1px solid rgba(255,255,255,.10);font:500 13px/1.4 ui-sans-serif,system-ui;white-space:pre-wrap}
  .ccp-user{justify-content:flex-end}
  .ccp-user .ccp-bubble{background:#34d399;color:#04120a;border-color:rgba(0,0,0,.12)}
  .ccp-assistant{justify-content:flex-start}
  .ccp-assistant .ccp-bubble{background:rgba(255,255,255,.06)}
  .ccp-footer{padding:10px 12px;border-top:1px solid rgba(255,255,255,.10);display:flex;gap:8px;align-items:flex-end}
  .ccp-input{flex:1;min-height:38px;max-height:120px;resize:none;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;padding:9px 10px;font:500 13px/1.35 ui-sans-serif,system-ui;outline:none}
  .ccp-send{width:40px;height:40px;border-radius:12px;border:0;background:#34d399;color:#04120a;font-weight:700;cursor:pointer}
  .ccp-send[disabled]{opacity:.45;cursor:not-allowed}
  .ccp-meta{padding:0 12px 10px 12px;font:12px/1.3 ui-sans-serif,system-ui;color:rgba(255,255,255,.65)}
  .ccp-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);border-radius:999px;padding:7px 10px;color:#fff;font:600 12px/1 ui-sans-serif,system-ui;cursor:pointer}
  `;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const launcher = document.createElement("button");
  launcher.className = "ccp-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.textContent = "💬";

  const panel = document.createElement("div");
  panel.className = "ccp-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", TITLE);

  const header = document.createElement("div");
  header.className = "ccp-header";

  const title = document.createElement("div");
  title.className = "ccp-title";
  title.textContent = TITLE;

  const closeBtn = document.createElement("button");
  closeBtn.className = "ccp-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close chat");
  closeBtn.textContent = "×";

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "ccp-body";

  const meta = document.createElement("div");
  meta.className = "ccp-meta";

  const footer = document.createElement("div");
  footer.className = "ccp-footer";

  const input = document.createElement("textarea");
  input.className = "ccp-input";
  input.rows = 1;
  input.placeholder = "Ask a question…";

  const send = document.createElement("button");
  send.className = "ccp-send";
  send.type = "button";
  send.textContent = "↑";

  footer.appendChild(input);
  footer.appendChild(send);

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);
  panel.appendChild(meta);

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  let open = false;
  let busy = false;
  let abortCtrl = null;
  const messages = [];

  function setOpen(v) {
    open = v;
    panel.style.display = open ? "flex" : "none";
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) {
      setTimeout(() => input.focus(), 50);
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    body.scrollTop = body.scrollHeight;
  }

  function autoresize() {
    input.style.height = "0px";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }

  function addMsg(role, text) {
    const row = document.createElement("div");
    row.className = "ccp-row " + (role === "user" ? "ccp-user" : "ccp-assistant");

    const bubble = document.createElement("div");
    bubble.className = "ccp-bubble";
    bubble.textContent = text;

    row.appendChild(bubble);
    body.appendChild(row);
    messages.push({ role, content: text });
    scrollToBottom();
  }

  function setMeta(text) {
    meta.textContent = text || "";
  }

  function setBusy(v) {
    busy = v;
    send.disabled = busy || !(input.value || "").trim() || !navigator.onLine;
    launcher.disabled = false;
  }

  async function sendMessage() {
    const text = (input.value || "").trim();
    if (!text || busy) return;

    if (!navigator.onLine) {
      setMeta("You’re offline. Check your connection and try again.");
      return;
    }

    addMsg("user", text);
    input.value = "";
    autoresize();
    setMeta("");
    setBusy(true);

    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: BOT_ID, messages: messages.slice(-20) }),
        signal: abortCtrl.signal,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const reply = (data && (data.message || data.reply)) || "";
      addMsg("assistant", reply || "Sorry — I couldn’t generate a response.");

      // Optional action support
      const action = data && data.action;
      if (action && action.type === "open_contact") {
        const url = action.contactUrl || CONTACT_URL;
        if (url) {
          const chip = document.createElement("button");
          chip.className = "ccp-chip";
          chip.type = "button";
          chip.textContent = "Open contact form";
          chip.onclick = () => {
            try {
              const u = new URL(url, window.location.origin);
              const summary = (action.payload && action.payload.summary) ? String(action.payload.summary) : "";
              if (summary) u.searchParams.set("message", summary);
              window.location.href = u.toString();
            } catch {
              window.location.href = url;
            }
          };
          meta.textContent = "";
          meta.appendChild(chip);
        }
      }
    } catch (err) {
      if (String(err?.name) === "AbortError") {
        setMeta("Stopped.");
      } else {
        setMeta("Chat error. Try again, or use the contact page.");
      }
    } finally {
      setBusy(false);
    }
  }

  launcher.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));

  input.addEventListener("input", () => {
    autoresize();
    send.disabled = busy || !(input.value || "").trim() || !navigator.onLine;
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  send.addEventListener("click", sendMessage);

  window.addEventListener("online", () => {
    setMeta("");
    setBusy(busy);
  });
  window.addEventListener("offline", () => {
    setMeta("Offline.");
    setBusy(busy);
  });

  // Initial greeting
  addMsg("assistant", "Hi — how can I help?");
  setBusy(false);
})();