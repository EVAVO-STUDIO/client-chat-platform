// EVAVO Client Chat Platform embeddable widget.
//
// <script
//   src="https://static.example.com/embed.js"
//   data-api-base="https://client-chat-platform.example.workers.dev"
//   data-bot-id="evavo"
//   data-title="Ask EVAVO"
//   data-contact="/contact"
// ></script>

(() => {
  "use strict";

  const script = document.currentScript;
  if (!script) return;

  function apiOrigin(value) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
      const protocolAllowed = url.protocol === "https:" || (url.protocol === "http:" && local);
      if (
        !protocolAllowed ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.pathname !== "/" && url.pathname !== "")
      ) {
        return null;
      }
      return url.origin;
    } catch {
      return null;
    }
  }

  function safeContactUrl(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return "";
    if (
      candidate.startsWith("/") &&
      !candidate.startsWith("//") &&
      !candidate.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(candidate)
    ) {
      return candidate.slice(0, 512);
    }
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || url.username || url.password) return "";
      return url.toString().slice(0, 2048);
    } catch {
      return "";
    }
  }

  function boundedText(value, fallback, maximum) {
    const candidate = String(value || "").trim();
    return (candidate || fallback).slice(0, maximum);
  }

  const botId = String(
    script.getAttribute("data-bot-id") || script.getAttribute("data-bot") || "",
  ).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId)) return;

  const scriptOrigin = (() => {
    try {
      return new URL(script.src, window.location.href).origin;
    } catch {
      return "";
    }
  })();
  const base = apiOrigin(script.getAttribute("data-api-base") || scriptOrigin);
  if (!base) return;

  const registryKey = "__EVAVO_CLIENT_CHAT_WIDGETS__";
  const registry = window[registryKey] instanceof Set
    ? window[registryKey]
    : new Set();
  window[registryKey] = registry;
  const registration = `${base}|${botId}`;
  if (registry.has(registration)) return;
  registry.add(registration);

  const title = boundedText(script.getAttribute("data-title"), "Chat", 80);
  const greeting = boundedText(
    script.getAttribute("data-greeting"),
    "Hi. What would you like help with?",
    500,
  );
  const contactUrl = safeContactUrl(script.getAttribute("data-contact"));
  const accentCandidate = String(script.getAttribute("data-accent") || "").trim();
  const accent = /^#[0-9a-f]{6}$/i.test(accentCandidate)
    ? accentCandidate
    : "#ff244e";
  const position = script.getAttribute("data-position") === "left" ? "left" : "right";
  const styleNonce = String(script.getAttribute("data-style-nonce") || "").trim();
  const instanceId = `evavo-chat-${
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;

  const host = document.createElement("div");
  host.setAttribute("data-evavo-client-chat", botId);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  if (styleNonce) style.setAttribute("nonce", styleNonce);
  style.textContent = `
    :host{all:initial;--accent:${accent};--bg:#0a0d12;--panel:#111722;--text:#f4f7fb;--muted:#9aa6b4;--line:#2a3544;--focus:#ffd0d9;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}
    *,*::before,*::after{box-sizing:border-box}
    button,textarea{font:inherit}
    button:focus-visible,textarea:focus-visible,a:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
    .launcher{position:fixed;z-index:2147483000;bottom:18px;${position}:18px;min-width:58px;height:48px;border:1px solid color-mix(in srgb,var(--accent) 58%,white 12%);border-radius:999px;background:var(--accent);color:#090a0d;padding:0 17px;font-size:13px;font-weight:900;box-shadow:0 18px 48px rgba(0,0,0,.38);cursor:pointer;transition:transform .16s ease,filter .16s ease}
    .launcher:hover{filter:brightness(1.08);transform:translateY(-1px)}
    .launcher[aria-expanded="true"]{background:#fff;border-color:#fff}
    .panel{position:fixed;z-index:2147483000;bottom:78px;${position}:18px;width:min(390px,calc(100vw - 24px));height:min(620px,calc(100dvh - 104px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--bg);color:var(--text);box-shadow:0 28px 90px rgba(0,0,0,.52)}
    .panel[hidden]{display:none}
    .header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--panel),var(--bg))}
    .identity{min-width:0;display:flex;align-items:center;gap:10px}
    .mark{width:9px;height:9px;flex:0 0 auto;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 18%,transparent)}
    .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:850}
    .close{width:38px;height:38px;flex:0 0 auto;border:1px solid var(--line);border-radius:10px;background:#171e29;color:var(--text);font-size:21px;line-height:1;cursor:pointer}
    .log{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:15px;display:flex;flex-direction:column;gap:11px;scrollbar-width:thin;scrollbar-color:#3b485a transparent}
    .row{display:flex}.row.user{justify-content:flex-end}.row.assistant{justify-content:flex-start}
    .bubble{max-width:86%;border:1px solid var(--line);border-radius:16px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.48}
    .user .bubble{border-color:color-mix(in srgb,var(--accent) 58%,black);background:var(--accent);color:#07080b;border-bottom-right-radius:5px}
    .assistant .bubble{background:var(--panel);color:var(--text);border-bottom-left-radius:5px}
    .meta{min-height:25px;padding:0 14px 9px;color:var(--muted);font-size:11px;line-height:1.45}
    .meta.error{color:#ff9aac}
    .action{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border:1px solid var(--line);border-radius:999px;background:#171f2b;color:var(--text);padding:8px 12px;font-size:12px;font-weight:800;text-decoration:none;cursor:pointer}
    .action.primary{border-color:var(--accent);background:var(--accent);color:#08090c}
    .action:disabled{cursor:not-allowed;opacity:.55}
    .consent{display:grid;gap:8px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:12px;background:#101722;padding:10px 11px;color:var(--text)}
    .consent-copy{margin:0;color:#cdd6e2;font-size:11px;line-height:1.5}
    .consent-strong{color:#fff;font-weight:800;overflow-wrap:anywhere}
    .consent-message{margin:0;border-left:2px solid #39475a;padding-left:8px;color:#aeb9c7;font-size:11px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
    .consent-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}
    .composer{border-top:1px solid var(--line);background:var(--panel);padding:11px}
    .input-row{display:flex;align-items:flex-end;gap:8px}
    .input{flex:1;min-height:42px;max-height:126px;resize:none;border:1px solid var(--line);border-radius:12px;background:#0c1119;color:var(--text);padding:10px 11px;outline:none;font-size:13px;line-height:1.4}
    .input::placeholder{color:#748091}
    .send{width:44px;height:44px;flex:0 0 auto;border:0;border-radius:12px;background:var(--accent);color:#08090c;font-size:17px;font-weight:950;cursor:pointer}
    .send:disabled{cursor:not-allowed;filter:grayscale(.55);opacity:.5}
    .privacy{margin:7px 2px 0;color:#7f8b9a;font-size:10px;line-height:1.35}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:520px){.launcher{bottom:12px;${position}:12px}.panel{bottom:70px;${position}:12px;width:calc(100vw - 24px);height:min(680px,calc(100dvh - 88px));border-radius:16px}}
    @media(prefers-reduced-motion:reduce){.launcher{transition:none}}
  `;

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.textContent = "Chat";
  launcher.setAttribute("aria-label", `Open ${title}`);
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", instanceId);

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.id = instanceId;
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", `${instanceId}-title`);

  const header = document.createElement("header");
  header.className = "header";
  const identity = document.createElement("div");
  identity.className = "identity";
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  const heading = document.createElement("div");
  heading.className = "title";
  heading.id = `${instanceId}-title`;
  heading.textContent = title;
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", `Close ${title}`);
  identity.append(mark, heading);
  header.append(identity, close);

  const log = document.createElement("div");
  log.className = "log";
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-relevant", "additions text");
  log.setAttribute("aria-label", "Chat messages");

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.setAttribute("role", "status");
  meta.setAttribute("aria-live", "polite");

  const composer = document.createElement("div");
  composer.className = "composer";
  const inputRow = document.createElement("div");
  inputRow.className = "input-row";
  const label = document.createElement("label");
  label.className = "sr-only";
  label.htmlFor = `${instanceId}-input`;
  label.textContent = "Message";
  const input = document.createElement("textarea");
  input.className = "input";
  input.id = `${instanceId}-input`;
  input.rows = 1;
  input.maxLength = 2000;
  input.placeholder = "Ask a question…";
  input.setAttribute("enterkeyhint", "send");
  const send = document.createElement("button");
  send.className = "send";
  send.type = "button";
  send.textContent = "↑";
  send.setAttribute("aria-label", "Send message");
  const privacy = document.createElement("p");
  privacy.className = "privacy";
  privacy.textContent = "Do not share passwords, access credentials or confidential records.";
  inputRow.append(label, input, send);
  composer.append(inputRow, privacy);
  panel.append(header, log, meta, composer);
  shadow.append(style, launcher, panel);
  document.body.appendChild(host);

  let open = false;
  let busy = false;
  let activeController = null;
  const messages = [];

  function scrollToBottom() {
    log.scrollTop = log.scrollHeight;
  }

  function setMeta(message, error = false) {
    meta.replaceChildren();
    meta.textContent = message || "";
    meta.classList.toggle("error", error);
  }

  function addBubble(role, content, persist = true) {
    const safeRole = role === "user" ? "user" : "assistant";
    const maximum = safeRole === "user" ? 2000 : 8000;
    const safeContent = String(content || "").trim().slice(0, maximum);
    if (!safeContent) return;
    const row = document.createElement("div");
    row.className = `row ${safeRole}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = safeContent;
    row.appendChild(bubble);
    log.appendChild(row);
    if (persist) {
      messages.push({ role: safeRole, content: safeContent });
      if (messages.length > 20) messages.splice(0, messages.length - 20);
    }
    scrollToBottom();
  }

  function autoResize() {
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 126)}px`;
  }

  function updateControls() {
    const online = navigator.onLine !== false;
    send.disabled = busy || !online || !input.value.trim();
    input.disabled = busy;
    panel.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function setOpen(next) {
    open = Boolean(next);
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    launcher.setAttribute("aria-label", `${open ? "Close" : "Open"} ${title}`);
    if (open) {
      setTimeout(() => input.focus(), 0);
      scrollToBottom();
    } else {
      launcher.focus();
    }
  }

  async function readJsonBounded(response, maximumBytes = 65536) {
    const declared = response.headers.get("content-length");
    if (
      declared !== null &&
      (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
    ) {
      throw new Error("invalid_response");
    }
    if (!response.body) return {};
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (!next.value) continue;
        total += next.value.byteLength;
        if (total > maximumBytes) {
          await reader.cancel("response_too_large").catch(() => undefined);
          throw new Error("invalid_response");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(combined);
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid_response");
    }
    return value;
  }

  function actionUrl(value) {
    const candidate = safeContactUrl(value) || contactUrl;
    if (!candidate) return "";
    try {
      return new URL(candidate, window.location.origin).toString();
    } catch {
      return "";
    }
  }

  function showContactAction(action) {
    const url = actionUrl(action && action.contactUrl);
    if (!url) return;
    const link = document.createElement("a");
    link.className = "action";
    link.href = url;
    link.textContent = "Open contact page";
    link.referrerPolicy = "no-referrer";
    if (new URL(url).origin !== window.location.origin) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    meta.replaceChildren(link);
    meta.classList.remove("error");
  }

  function leadText(value, maximum) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
  }

  function evidenceText(value) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }

  function userEvidence() {
    return messages
      .filter((message) => message.role === "user")
      .map((message) => message.content.trim().slice(0, 2000))
      .filter(Boolean)
      .slice(-20);
  }

  function textSupported(value, evidence) {
    const normalized = evidenceText(value);
    return Boolean(
      normalized &&
      evidence.some((message) => evidenceText(message).includes(normalized)),
    );
  }

  function phoneSupported(value, evidence) {
    const digits = value.replace(/\D/g, "");
    return Boolean(
      digits.length >= 6 &&
      evidence.some((message) => message.replace(/\D/g, "").includes(digits)),
    );
  }

  function emailFromEvidence(payload, evidence) {
    const proposed =
      leadText(payload && payload.email, 320) ||
      leadText(payload && payload.contactEmail, 320);
    if (
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed) &&
      textSupported(proposed, evidence)
    ) {
      return proposed.toLowerCase();
    }
    for (const message of [...evidence].reverse()) {
      const match = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (match) return match[0].toLowerCase().slice(0, 320);
    }
    return "";
  }

  function messageFromEvidence(payload, evidence) {
    const proposed =
      leadText(payload && payload.message, 2000) ||
      leadText(payload && payload.summary, 2000) ||
      leadText(payload && payload.details, 2000);
    if (proposed.length >= 10 && textSupported(proposed, evidence)) {
      return proposed;
    }
    return [...evidence].reverse().find((message) => message.length >= 10) || "";
  }

  function optionalEvidenceField(payload, key, maximum, evidence) {
    const value = leadText(payload && payload[key], maximum);
    return value && textSupported(value, evidence) ? value : undefined;
  }

  function normalizedLeadProposal(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const evidence = userEvidence();
    if (!evidence.length) return null;
    const email = emailFromEvidence(value, evidence);
    const message = messageFromEvidence(value, evidence);
    if (!email || message.length < 10) return null;
    const phoneCandidate = leadText(value.phone, 40);
    const phone = phoneCandidate && phoneSupported(phoneCandidate, evidence)
      ? phoneCandidate
      : undefined;
    return {
      evidence,
      lead: {
        name: optionalEvidenceField(value, "name", 120, evidence),
        email,
        phone,
        company: optionalEvidenceField(value, "company", 160, evidence),
        message,
        sourcePath: window.location.pathname.slice(0, 512) || "/",
      },
    };
  }

  async function submitLead(proposal, confirm, cancel) {
    if (busy || navigator.onLine === false) return;
    busy = true;
    confirm.disabled = true;
    cancel.disabled = true;
    confirm.textContent = "Sharing…";
    updateControls();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), 15000);
    try {
      const response = await fetch(`${base}/api/leads`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          consent: true,
          evidence: proposal.evidence,
          lead: proposal.lead,
        }),
        signal: controller.signal,
      });
      const data = await readJsonBounded(response, 32768).catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        throw Object.assign(new Error("lead_request_failed"), {
          status: response.status,
        });
      }
      const retentionDays = Number(data.retentionDays);
      setMeta(
        Number.isSafeInteger(retentionDays) && retentionDays > 0
          ? `Your enquiry details were saved for follow-up and are scheduled to expire after ${retentionDays} days.`
          : "Your enquiry details were saved for follow-up.",
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setMeta("The follow-up request took too long. Nothing was confirmed.", true);
      } else if (Number(error && error.status) === 429) {
        setMeta("Too many follow-up requests were attempted. Try again later.", true);
      } else {
        setMeta("The follow-up request was not saved. Use the contact page instead.", true);
      }
    } finally {
      clearTimeout(timeout);
      busy = false;
      updateControls();
      input.focus();
    }
  }

  function showLeadConsent(action) {
    const proposal = normalizedLeadProposal(action && action.payload);
    if (!proposal) {
      showContactAction(action);
      return;
    }
    const box = document.createElement("div");
    box.className = "consent";
    const copy = document.createElement("p");
    copy.className = "consent-copy";
    copy.append("Share the email and message you provided for follow-up at ");
    const email = document.createElement("span");
    email.className = "consent-strong";
    email.textContent = proposal.lead.email;
    copy.append(
      email,
      "? Nothing is saved until you choose Share. The record is retained for up to 90 days.",
    );
    const excerpt = document.createElement("p");
    excerpt.className = "consent-message";
    excerpt.textContent = proposal.lead.message.length > 180
      ? `${proposal.lead.message.slice(0, 179)}…`
      : proposal.lead.message;
    const actions = document.createElement("div");
    actions.className = "consent-actions";
    const confirm = document.createElement("button");
    confirm.className = "action primary";
    confirm.type = "button";
    confirm.textContent = "Share for follow-up";
    const cancel = document.createElement("button");
    cancel.className = "action";
    cancel.type = "button";
    cancel.textContent = "Not now";
    confirm.addEventListener("click", () =>
      void submitLead(proposal, confirm, cancel),
    );
    cancel.addEventListener("click", () =>
      setMeta("Follow-up details were not shared."),
    );
    actions.append(confirm, cancel);
    box.append(copy, excerpt, actions);
    meta.replaceChildren(box);
    meta.classList.remove("error");
    confirm.focus();
  }

  function publicErrorMessage(status) {
    if (status === 429) return "Chat is busy right now. Try again shortly.";
    if (status === 403) return "Chat is not enabled for this website origin.";
    if (status === 401) return "Chat access is not available from this client.";
    return "Chat could not respond. Try again or use the contact page.";
  }

  async function sendMessage() {
    const content = input.value.trim();
    if (!content || busy || navigator.onLine === false) return;
    addBubble("user", content);
    input.value = "";
    autoResize();
    setMeta("Preparing a response…");
    busy = true;
    updateControls();

    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort("timeout"), 20000);

    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, messages: messages.slice(-20) }),
        signal: controller.signal,
      });
      const data = await readJsonBounded(response).catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw Object.assign(new Error("chat_request_failed"), {
          status: response.status,
        });
      }
      const reply = typeof data.message === "string"
        ? data.message
        : typeof data.reply === "string"
          ? data.reply
          : "";
      if (!reply.trim()) {
        throw Object.assign(new Error("empty_reply"), { status: 502 });
      }
      addBubble("assistant", reply);
      setMeta("");
      if (data.action && data.action.type === "open_contact") {
        showContactAction(data.action);
      } else if (data.action && data.action.type === "create_lead") {
        showLeadConsent(data.action);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setMeta("The response took too long. Try again.", true);
      } else {
        setMeta(publicErrorMessage(Number(error && error.status)), true);
      }
    } finally {
      clearTimeout(timeout);
      if (activeController === controller) activeController = null;
      busy = false;
      updateControls();
      if (!meta.querySelector(".consent")) input.focus();
    }
  }

  function focusableElements() {
    return [close, input, send, ...meta.querySelectorAll("a,button")].filter(
      (element) => !element.disabled && !element.hidden,
    );
  }

  launcher.addEventListener("click", () => setOpen(!open));
  close.addEventListener("click", () => setOpen(false));
  send.addEventListener("click", () => void sendMessage());
  input.addEventListener("input", () => {
    autoResize();
    updateControls();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && shadow.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  window.addEventListener("online", () => {
    if (meta.textContent === "You are offline.") setMeta("");
    updateControls();
  });
  window.addEventListener("offline", () => {
    setMeta("You are offline.", true);
    updateControls();
  });
  window.addEventListener(
    "pagehide",
    () => activeController?.abort("pagehide"),
    { once: true },
  );

  addBubble("assistant", greeting, false);
  updateControls();
})();
